-- PNRR3 Basilicata V4.5
-- Gestione diretta delle compilazioni dalle segnalazioni di assistenza.
-- Eseguire dopo la migrazione V4.4.

begin;

alter table public.manual_support_requests
  add column if not exists candidate_id bigint
    references public.candidati(id) on delete set null;

drop function if exists public.admin_list_manual_support_requests(text);

create or replace function public.admin_list_manual_support_requests(
  p_status text default 'pending'
)
returns table(
  id bigint,
  email text,
  contact_email text,
  classe text,
  posizione integer,
  punteggio numeric,
  issue text,
  note text,
  status text,
  admin_note text,
  existing_matches bigint,
  candidate_id bigint,
  created_at timestamptz,
  updated_at timestamptz,
  reviewed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
  select
    r.id::bigint,
    r.email::text,
    r.contact_email::text,
    r.classe::text,
    r.posizione::integer,
    r.punteggio::numeric,
    r.issue::text,
    r.note::text,
    r.status::text,
    r.admin_note::text,
    (
      select count(*)::bigint
      from public.candidati c
      cross join lateral jsonb_to_recordset(c.candidature) as j(
        classe text,
        posizione integer,
        punteggio numeric
      )
      where j.classe=r.classe
        and j.posizione=r.posizione
        and round(j.punteggio,2)=round(r.punteggio,2)
    )::bigint as existing_matches,
    r.candidate_id::bigint,
    r.created_at::timestamptz,
    r.updated_at::timestamptz,
    r.reviewed_at::timestamptz
  from public.manual_support_requests r
  where p_status='all' or r.status=p_status
  order by
    case r.status
      when 'pending' then 0
      when 'in_progress' then 1
      when 'resolved' then 2
      else 3
    end,
    r.created_at desc;
end;
$$;

create or replace function public.admin_find_manual_support_candidates(
  p_request_id bigint
)
returns table(
  candidate_id bigint,
  email text,
  candidature jsonb,
  comuni text[],
  provincia_1 text,
  provincia_2 text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.manual_support_requests%rowtype;
begin
  perform public.require_admin();

  select * into request_row
  from public.manual_support_requests
  where id=p_request_id;

  if request_row.id is null then
    raise exception 'Segnalazione non trovata';
  end if;

  return query
  select
    c.id::bigint,
    u.email::text,
    c.candidature::jsonb,
    c.comuni::text[],
    c.provincia_1::text,
    c.provincia_2::text
  from public.candidati c
  left join auth.users u on u.id=c.user_id
  where exists(
    select 1
    from jsonb_to_recordset(c.candidature) as j(
      classe text,
      posizione integer,
      punteggio numeric
    )
    where j.classe=request_row.classe
      and j.posizione=request_row.posizione
      and round(j.punteggio,2)=round(request_row.punteggio,2)
  )
  order by c.id;
end;
$$;

create or replace function public.admin_attach_manual_support_candidate(
  p_request_id bigint,
  p_candidate_id bigint,
  p_account_email text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.manual_support_requests%rowtype;
  target_user uuid;
  current_user uuid;
begin
  perform public.require_admin();

  select * into request_row
  from public.manual_support_requests
  where id=p_request_id
  for update;

  if request_row.id is null then
    raise exception 'Segnalazione non trovata';
  end if;

  if not exists(
    select 1
    from public.candidati c
    cross join lateral jsonb_to_recordset(c.candidature) as j(
      classe text,
      posizione integer,
      punteggio numeric
    )
    where c.id=p_candidate_id
      and j.classe=request_row.classe
      and j.posizione=request_row.posizione
      and round(j.punteggio,2)=round(request_row.punteggio,2)
  ) then
    raise exception 'Il record non coincide con classe, posizione e punteggio della segnalazione';
  end if;

  if nullif(trim(coalesce(p_account_email,'')),'') is not null then
    select id into target_user
    from auth.users
    where lower(email)=lower(trim(p_account_email))
    limit 1;

    if target_user is null then
      raise exception 'L’email indicata non corrisponde a un account registrato';
    end if;

    if exists(
      select 1 from public.candidati
      where user_id=target_user and id<>p_candidate_id
    ) then
      raise exception 'L’account indicato possiede già un altro record';
    end if;

    select user_id into current_user
    from public.candidati
    where id=p_candidate_id;

    if current_user is not null and current_user<>target_user then
      raise exception 'Il record è già associato a un altro account';
    end if;

    update public.candidati
    set user_id=target_user,
        updated_at=now()
    where id=p_candidate_id;
  end if;

  update public.manual_support_requests
  set candidate_id=p_candidate_id,
      status='resolved',
      admin_note=case
        when target_user is null
          then 'Segnalazione collegata a una compilazione esistente.'
        else 'Segnalazione collegata alla compilazione e all’account indicato.'
      end,
      updated_at=now(),
      reviewed_at=now(),
      reviewed_by=auth.uid()
  where id=p_request_id;

  return true;
end;
$$;

create or replace function public.admin_create_candidate_from_manual_support(
  p_request_id bigint,
  p_provincia_1 text,
  p_provincia_2 text,
  p_comuni text[],
  p_account_email text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.manual_support_requests%rowtype;
  target_user uuid;
  new_candidate_id bigint;
  clean_comuni text[];
begin
  perform public.require_admin();

  select * into request_row
  from public.manual_support_requests
  where id=p_request_id
  for update;

  if request_row.id is null then
    raise exception 'Segnalazione non trovata';
  end if;

  if request_row.candidate_id is not null then
    raise exception 'La segnalazione è già collegata al record #%s', request_row.candidate_id;
  end if;

  if p_provincia_1 not in ('Potenza','Matera') then
    raise exception 'Provincia principale non valida';
  end if;

  if nullif(trim(coalesce(p_provincia_2,'')),'') is not null
     and p_provincia_2 not in ('Potenza','Matera') then
    raise exception 'Seconda provincia non valida';
  end if;

  if nullif(trim(coalesce(p_provincia_2,'')),'')=p_provincia_1 then
    raise exception 'Le due province devono essere diverse';
  end if;

  select array_agg(trim(value))
  into clean_comuni
  from unnest(coalesce(p_comuni,array[]::text[])) value
  where nullif(trim(value),'') is not null;

  if coalesce(cardinality(clean_comuni),0) not between 1 and 20 then
    raise exception 'Inserisci da 1 a 20 comuni';
  end if;

  if public.registration_tuple_exists(
    request_row.classe,
    request_row.posizione,
    request_row.punteggio,
    null
  ) then
    raise exception 'Esiste già una compilazione con gli stessi dati: usa “Cerca record coincidenti”';
  end if;

  if nullif(trim(coalesce(p_account_email,'')),'') is not null then
    select id into target_user
    from auth.users
    where lower(email)=lower(trim(p_account_email))
    limit 1;

    if target_user is null then
      raise exception 'L’email indicata non corrisponde a un account registrato';
    end if;

    if exists(select 1 from public.candidati where user_id=target_user) then
      raise exception 'L’account indicato possiede già una compilazione';
    end if;
  end if;

  insert into public.candidati(
    classe_concorso,
    posizione,
    punteggio,
    candidature,
    provincia_1,
    provincia_2,
    comuni,
    user_id,
    preferenze_scuole,
    updated_at
  )
  values(
    null,
    null,
    null,
    jsonb_build_array(
      jsonb_build_object(
        'classe',request_row.classe,
        'posizione',request_row.posizione,
        'punteggio',request_row.punteggio
      )
    ),
    p_provincia_1,
    nullif(trim(coalesce(p_provincia_2,'')),''),
    clean_comuni,
    target_user,
    null,
    now()
  )
  returning id into new_candidate_id;

  update public.manual_support_requests
  set candidate_id=new_candidate_id,
      status='resolved',
      admin_note=case
        when target_user is null
          then 'Compilazione creata manualmente senza associazione a un account.'
        else 'Compilazione creata manualmente e associata all’account indicato.'
      end,
      updated_at=now(),
      reviewed_at=now(),
      reviewed_by=auth.uid()
  where id=p_request_id;

  return new_candidate_id;
end;
$$;

revoke all on function public.admin_list_manual_support_requests(text) from public;
revoke all on function public.admin_find_manual_support_candidates(bigint) from public;
revoke all on function public.admin_attach_manual_support_candidate(bigint,bigint,text) from public;
revoke all on function public.admin_create_candidate_from_manual_support(
  bigint,text,text,text[],text
) from public;

grant execute on function public.admin_list_manual_support_requests(text) to authenticated;
grant execute on function public.admin_find_manual_support_candidates(bigint) to authenticated;
grant execute on function public.admin_attach_manual_support_candidate(bigint,bigint,text) to authenticated;
grant execute on function public.admin_create_candidate_from_manual_support(
  bigint,text,text,text[],text
) to authenticated;

notify pgrst,'reload schema';

commit;
