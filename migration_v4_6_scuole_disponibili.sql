-- PNRR3 Basilicata V4.6
-- Le segnalazioni di assistenza raccolgono scuole/plessi con disponibilità,
-- non preferenze comunali.
-- Eseguire dopo le migrazioni V4.4 e V4.5.

begin;

alter table public.manual_support_requests
  add column if not exists preferenze_scuole jsonb;

drop function if exists public.submit_manual_support_request(
  text,text,text,integer,numeric,text,text,text
);

create or replace function public.submit_manual_support_request(
  p_email text,
  p_contact_email text,
  p_classe text,
  p_posizione integer,
  p_punteggio numeric,
  p_issue text,
  p_note text default null,
  p_preferenze_scuole jsonb default null,
  p_website text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_email text := lower(trim(coalesce(p_email,'')));
  clean_contact text := nullif(lower(trim(coalesce(p_contact_email,''))),'');
  existing_id bigint;
begin
  if nullif(trim(coalesce(p_website,'')),'') is not null then
    return true;
  end if;

  if clean_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Inserisci un indirizzo email valido';
  end if;

  if clean_contact is not null
     and clean_contact !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Inserisci un indirizzo alternativo valido';
  end if;

  if p_classe not in ('AAAA','ADAA','EEEE','ADEE')
     or p_posizione is null or p_posizione < 1
     or p_punteggio is null or p_punteggio < 0 then
    raise exception 'Controlla classe, posizione e punteggio';
  end if;

  if p_issue not in ('google','otp','both','existing_account','other') then
    raise exception 'Seleziona il problema riscontrato';
  end if;

  if length(coalesce(p_note,'')) > 800 then
    raise exception 'La nota è troppo lunga';
  end if;

  if jsonb_typeof(p_preferenze_scuole) <> 'array'
     or jsonb_array_length(p_preferenze_scuole) not between 1 and 30 then
    raise exception 'Seleziona da 1 a 30 scuole';
  end if;

  if exists(
    select 1
    from jsonb_to_recordset(p_preferenze_scuole) as pref(
      classe text,
      codice_scuola text,
      ordine integer
    )
    where pref.classe <> p_classe
       or coalesce(pref.codice_scuola,'') !~ '^[A-Z0-9]{10}$'
       or pref.ordine is null
       or pref.ordine < 1
  ) then
    raise exception 'Le preferenze scolastiche non sono valide';
  end if;

  if (
    select count(distinct pref.codice_scuola)
    from jsonb_to_recordset(p_preferenze_scuole) as pref(
      classe text,
      codice_scuola text,
      ordine integer
    )
  ) <> jsonb_array_length(p_preferenze_scuole) then
    raise exception 'La stessa scuola non può essere selezionata più volte';
  end if;

  select id into existing_id
  from public.manual_support_requests
  where lower(email)=clean_email
    and status in ('pending','in_progress')
  order by created_at desc
  limit 1;

  if existing_id is not null then
    update public.manual_support_requests
    set contact_email=clean_contact,
        classe=p_classe,
        posizione=p_posizione,
        punteggio=round(p_punteggio,2),
        issue=p_issue,
        note=nullif(trim(coalesce(p_note,'')),''),
        preferenze_scuole=p_preferenze_scuole,
        updated_at=now()
    where id=existing_id;
  else
    insert into public.manual_support_requests(
      email,contact_email,classe,posizione,punteggio,issue,note,
      preferenze_scuole
    )
    values(
      clean_email,
      clean_contact,
      p_classe,
      p_posizione,
      round(p_punteggio,2),
      p_issue,
      nullif(trim(coalesce(p_note,'')),''),
      p_preferenze_scuole
    );
  end if;

  return true;
end;
$$;

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
  preferenze_scuole jsonb,
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
    r.preferenze_scuole::jsonb,
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
    )::bigint,
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

drop function if exists public.admin_create_candidate_from_manual_support(
  bigint,text,text,text[],text
);

create or replace function public.admin_create_candidate_from_manual_support(
  p_request_id bigint,
  p_preferenze_scuole jsonb,
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
  candidature_data jsonb;
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
    raise exception 'La segnalazione è già collegata al record #%s',
      request_row.candidate_id;
  end if;

  candidature_data=jsonb_build_array(
    jsonb_build_object(
      'classe',request_row.classe,
      'posizione',request_row.posizione,
      'punteggio',request_row.punteggio
    )
  );

  if not public.validate_school_preferences(
    candidature_data,
    p_preferenze_scuole
  ) then
    raise exception 'Preferenze scolastiche non valide';
  end if;

  if exists(
    select 1
    from jsonb_to_recordset(p_preferenze_scuole) as pref(
      classe text,
      codice_scuola text,
      ordine integer
    )
    where pref.classe<>request_row.classe
  ) then
    raise exception 'Le scuole devono appartenere alla classe della segnalazione';
  end if;

  if p_preferenze_scuole is distinct from request_row.preferenze_scuole then
    raise exception 'Le preferenze non coincidono con quelle indicate dall’utente';
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
    raise exception 'Le scuole selezionate devono riferirsi ad almeno un comune';
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
    candidature_data,
    p_provincia_1,
    nullif(trim(coalesce(p_provincia_2,'')),''),
    clean_comuni,
    target_user,
    p_preferenze_scuole,
    now()
  )
  returning id into new_candidate_id;

  update public.manual_support_requests
  set candidate_id=new_candidate_id,
      status='resolved',
      admin_note=case
        when target_user is null
          then 'Compilazione creata con le scuole indicate, senza associazione a un account.'
        else 'Compilazione creata con le scuole indicate e associata all’account.'
      end,
      updated_at=now(),
      reviewed_at=now(),
      reviewed_by=auth.uid()
  where id=p_request_id;

  return new_candidate_id;
end;
$$;

revoke all on function public.submit_manual_support_request(
  text,text,text,integer,numeric,text,text,jsonb,text
) from public;
revoke all on function public.admin_list_manual_support_requests(text) from public;
revoke all on function public.admin_create_candidate_from_manual_support(
  bigint,jsonb,text,text,text[],text
) from public;

grant execute on function public.submit_manual_support_request(
  text,text,text,integer,numeric,text,text,jsonb,text
) to anon, authenticated;
grant execute on function public.admin_list_manual_support_requests(text)
  to authenticated;
grant execute on function public.admin_create_candidate_from_manual_support(
  bigint,jsonb,text,text,text[],text
) to authenticated;

notify pgrst,'reload schema';

commit;
