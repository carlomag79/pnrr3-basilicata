-- PNRR3 Basilicata V4.12.1
-- Gestione record e doppioni nelle aree riservate amministrative.
-- Corregge anche il salvataggio dei record storici senza preferenze scolastiche.
-- Eseguire dopo la migrazione V4.12.

begin;

create or replace function public.admin_list_user_related_records(
  p_user_id uuid
)
returns table(
  candidate_id bigint,
  candidature jsonb,
  comuni text[],
  preferences_count integer,
  is_linked boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
declare
  linked_candidate_id bigint;
  linked_signature text;
begin
  perform public.require_admin();

  select c.id
  into linked_candidate_id
  from public.candidati c
  where c.user_id=p_user_id
  order by c.updated_at desc nulls last,c.created_at desc
  limit 1;

  if linked_candidate_id is null then
    return;
  end if;

  select string_agg(
    concat(
      item.classe,':',
      item.posizione::text,':',
      to_char(round(item.punteggio,2),'FM999999990.00')
    ),
    '|'
    order by item.classe,item.posizione,round(item.punteggio,2)
  )
  into linked_signature
  from public.candidati c
  cross join lateral jsonb_to_recordset(c.candidature) as item(
    classe text,
    posizione integer,
    punteggio numeric
  )
  where c.id=linked_candidate_id
  group by c.id;

  return query
  with signatures as (
    select
      c.id,
      c.candidature,
      c.comuni,
      c.preferenze_scuole,
      c.user_id,
      c.created_at,
      c.updated_at,
      string_agg(
        concat(
          item.classe,':',
          item.posizione::text,':',
          to_char(round(item.punteggio,2),'FM999999990.00')
        ),
        '|'
        order by item.classe,item.posizione,round(item.punteggio,2)
      ) as signature
    from public.candidati c
    cross join lateral jsonb_to_recordset(c.candidature) as item(
      classe text,
      posizione integer,
      punteggio numeric
    )
    group by c.id
  )
  select
    s.id::bigint,
    s.candidature::jsonb,
    s.comuni::text[],
    case
      when jsonb_typeof(s.preferenze_scuole)='array'
        then jsonb_array_length(s.preferenze_scuole)
      else 0
    end::integer,
    (s.id=linked_candidate_id)::boolean,
    s.created_at::timestamptz,
    s.updated_at::timestamptz
  from signatures s
  where s.id=linked_candidate_id
     or (
       s.signature=linked_signature
       and s.user_id is null
     )
  order by
    case when s.id=linked_candidate_id then 0 else 1 end,
    s.updated_at desc nulls last,
    s.created_at desc;
end;
$$;

create or replace function public.admin_update_candidate_record(
  p_candidate_id bigint,
  p_candidature jsonb,
  p_preferenze_scuole jsonb,
  p_account_email text,
  p_provincia_1 text,
  p_provincia_2 text,
  p_comuni text[]
)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  target_user uuid;
  clean_email text:=nullif(lower(trim(coalesce(p_account_email,''))),'');
  prefs jsonb:=coalesce(p_preferenze_scuole,'[]'::jsonb);
  clean_comuni text[];
  current_record public.candidati%rowtype;
  final_provincia_1 text;
  final_provincia_2 text;
begin
  perform public.require_admin();

  select *
  into current_record
  from public.candidati
  where id=p_candidate_id
  for update;

  if current_record.id is null then
    raise exception 'Record non trovato';
  end if;

  if jsonb_typeof(p_candidature)<>'array'
     or jsonb_array_length(p_candidature) not between 1 and 4 then
    raise exception 'Inserisci da 1 a 4 candidature';
  end if;

  if exists(
    select 1
    from jsonb_to_recordset(p_candidature) as item(
      classe text,
      posizione integer,
      punteggio numeric
    )
    where item.classe not in ('AAAA','ADAA','EEEE','ADEE')
       or item.posizione is null
       or item.posizione<1
       or item.punteggio is null
       or item.punteggio<0
  ) then
    raise exception 'Candidature non valide';
  end if;

  if (
    select count(*)
    from jsonb_to_recordset(p_candidature) as item(
      classe text,
      posizione integer,
      punteggio numeric
    )
  ) <> (
    select count(distinct concat(
      item.classe,':',item.posizione::text,':',
      round(item.punteggio,2)::text
    ))
    from jsonb_to_recordset(p_candidature) as item(
      classe text,
      posizione integer,
      punteggio numeric
    )
  ) then
    raise exception 'La stessa candidatura non può essere inserita due volte';
  end if;

  if jsonb_typeof(prefs)<>'array'
     or jsonb_array_length(prefs)>30 then
    raise exception 'Le preferenze scolastiche devono essere comprese tra 0 e 30';
  end if;

  if exists(
    select 1
    from jsonb_to_recordset(prefs) as pref(
      classe text,
      codice_scuola text,
      ordine integer
    )
    where pref.classe not in ('AAAA','ADAA','EEEE','ADEE')
       or coalesce(pref.codice_scuola,'') !~ '^[A-Z0-9]{10}$'
       or pref.ordine is null
       or pref.ordine<1
       or not exists(
         select 1
         from jsonb_to_recordset(p_candidature) as item(
           classe text,
           posizione integer,
           punteggio numeric
         )
         where item.classe=pref.classe
       )
  ) then
    raise exception 'Preferenze scolastiche non valide';
  end if;

  if (
    select count(*)
    from jsonb_to_recordset(prefs) as pref(
      classe text,
      codice_scuola text,
      ordine integer
    )
  ) <> (
    select count(distinct concat(pref.classe,':',pref.codice_scuola))
    from jsonb_to_recordset(prefs) as pref(
      classe text,
      codice_scuola text,
      ordine integer
    )
  ) then
    raise exception 'La stessa scuola non può essere selezionata più volte per la stessa classe';
  end if;

  select array_agg(distinct trim(value) order by trim(value))
  into clean_comuni
  from unnest(coalesce(p_comuni,array[]::text[])) value
  where nullif(trim(value),'') is not null;

  -- I record storici senza scuole mantengono i comuni già pubblicati.
  if coalesce(cardinality(clean_comuni),0)=0 then
    clean_comuni=current_record.comuni;
  end if;

  if coalesce(cardinality(clean_comuni),0)=0 then
    raise exception 'Il record deve contenere almeno un comune storico o una preferenza scolastica';
  end if;

  -- I vecchi record possono contenere più di 20 comuni: non vanno bloccati.
  if cardinality(clean_comuni)>100 then
    raise exception 'Il numero dei comuni associati al record non è valido';
  end if;

  final_provincia_1=coalesce(
    nullif(trim(coalesce(p_provincia_1,'')),''),
    current_record.provincia_1
  );
  final_provincia_2=coalesce(
    nullif(trim(coalesce(p_provincia_2,'')),''),
    current_record.provincia_2
  );

  if final_provincia_1 not in ('Potenza','Matera') then
    final_provincia_1=current_record.provincia_1;
  end if;

  if final_provincia_2 is not null
     and final_provincia_2 not in ('Potenza','Matera') then
    final_provincia_2=current_record.provincia_2;
  end if;

  if final_provincia_2=final_provincia_1 then
    final_provincia_2=null;
  end if;

  if clean_email is not null then
    select id into target_user
    from auth.users
    where lower(email)=clean_email
    limit 1;

    if target_user is null then
      raise exception 'L’email indicata non corrisponde a un account registrato';
    end if;

    if exists(
      select 1
      from public.candidati
      where user_id=target_user
        and id<>p_candidate_id
    ) then
      raise exception 'L’account indicato possiede già un altro record';
    end if;
  end if;

  update public.candidati
  set candidature=p_candidature,
      preferenze_scuole=prefs,
      provincia_1=final_provincia_1,
      provincia_2=final_provincia_2,
      comuni=clean_comuni,
      user_id=target_user,
      updated_at=now()
  where id=p_candidate_id;

  return found;
end;
$$;

revoke all on function public.admin_list_user_related_records(uuid) from public;
revoke all on function public.admin_update_candidate_record(
  bigint,jsonb,jsonb,text,text,text,text[]
) from public;

grant execute on function public.admin_list_user_related_records(uuid)
to authenticated;
grant execute on function public.admin_update_candidate_record(
  bigint,jsonb,jsonb,text,text,text,text[]
) to authenticated;

notify pgrst,'reload schema';

commit;
