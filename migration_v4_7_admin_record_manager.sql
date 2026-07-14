-- PNRR3 Basilicata V4.7
-- Gestione completa dei record dall'area amministrativa.
-- Eseguire dopo le migrazioni precedenti.

begin;

create or replace function public.admin_get_candidate_record(
  p_candidate_id bigint
)
returns table(
  candidate_id bigint,
  email text,
  candidature jsonb,
  preferenze_scuole jsonb,
  provincia_1 text,
  provincia_2 text,
  comuni text[],
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.require_admin();

  return query
  select
    c.id::bigint,
    u.email::text,
    c.candidature::jsonb,
    coalesce(c.preferenze_scuole,'[]'::jsonb)::jsonb,
    c.provincia_1::text,
    c.provincia_2::text,
    c.comuni::text[],
    c.created_at::timestamptz,
    c.updated_at::timestamptz
  from public.candidati c
  left join auth.users u on u.id=c.user_id
  where c.id=p_candidate_id
  limit 1;
end;
$$;

create or replace function public.admin_bulk_delete_candidates(
  p_candidate_ids bigint[]
)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  deleted_count integer;
begin
  perform public.require_admin();

  if p_candidate_ids is null
     or coalesce(cardinality(p_candidate_ids),0)=0 then
    return 0;
  end if;

  if cardinality(p_candidate_ids)>300 then
    raise exception 'Puoi eliminare al massimo 300 record per operazione';
  end if;

  delete from public.candidati
  where id=any(p_candidate_ids);

  get diagnostics deleted_count=row_count;
  return deleted_count;
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
begin
  perform public.require_admin();

  if not exists(select 1 from public.candidati where id=p_candidate_id) then
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

  if p_provincia_1 not in ('Potenza','Matera') then
    raise exception 'Provincia principale non valida';
  end if;

  if nullif(trim(coalesce(p_provincia_2,'')),'') is not null
     and p_provincia_2 not in ('Potenza','Matera') then
    raise exception 'Seconda provincia non valida';
  end if;

  if nullif(trim(coalesce(p_provincia_2,'')),'')=p_provincia_1 then
    raise exception 'Le province devono essere diverse';
  end if;

  select array_agg(distinct trim(value))
  into clean_comuni
  from unnest(coalesce(p_comuni,array[]::text[])) value
  where nullif(trim(value),'') is not null;

  if coalesce(cardinality(clean_comuni),0) not between 1 and 20 then
    raise exception 'I dati territoriali ricavati dalle scuole non sono validi';
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
      provincia_1=p_provincia_1,
      provincia_2=nullif(trim(coalesce(p_provincia_2,'')),''),
      comuni=clean_comuni,
      user_id=target_user,
      updated_at=now()
  where id=p_candidate_id;

  return found;
end;
$$;

revoke all on function public.admin_get_candidate_record(bigint) from public;
revoke all on function public.admin_bulk_delete_candidates(bigint[]) from public;
revoke all on function public.admin_update_candidate_record(
  bigint,jsonb,jsonb,text,text,text,text[]
) from public;

grant execute on function public.admin_get_candidate_record(bigint)
to authenticated;
grant execute on function public.admin_bulk_delete_candidates(bigint[])
to authenticated;
grant execute on function public.admin_update_candidate_record(
  bigint,jsonb,jsonb,text,text,text,text[]
) to authenticated;

notify pgrst,'reload schema';

commit;
