-- HOTFIX PNRR3 Basilicata V4.13.2
-- La provincia assegnata diventa facoltativa per tutti i salvataggi.
-- Eseguire dopo la migrazione V4.13.

begin;

drop function if exists public.upsert_my_candidatura_v2(jsonb,jsonb,text,text[]);
drop function if exists public.upsert_my_candidatura_v2(jsonb,jsonb,text,text,text,text[]);

create function public.upsert_my_candidatura_v2(
  p_candidature jsonb,
  p_preferenze_scuole jsonb,
  p_provincia_assegnata text,
  p_provincia_1 text,
  p_provincia_2 text,
  p_comuni text[]
)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare
  target_id bigint;
  approved_request public.candidate_registration_requests%rowtype;
  current_record public.candidati%rowtype;
  clean_comuni text[];
  prefs jsonb:=coalesce(p_preferenze_scuole,'[]'::jsonb);
  clean_assigned text:=nullif(trim(coalesce(p_provincia_assegnata,'')),'');
  clean_provincia_1 text:=nullif(trim(coalesce(p_provincia_1,'')),'');
  clean_provincia_2 text:=nullif(trim(coalesce(p_provincia_2,'')),'');
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;

  if clean_assigned is not null
     and clean_assigned not in ('Matera','Potenza') then
    raise exception 'Provincia assegnata non valida';
  end if;

  if clean_provincia_1 not in ('Matera','Potenza') then
    raise exception 'Provincia principale non valida';
  end if;

  if clean_provincia_2 is not null
     and clean_provincia_2 not in ('Matera','Potenza') then
    raise exception 'Seconda provincia non valida';
  end if;

  if clean_provincia_2=clean_provincia_1 then
    clean_provincia_2=null;
  end if;

  if clean_assigned is not null then
    clean_provincia_1=clean_assigned;
    clean_provincia_2=null;
  end if;

  if not public.validate_school_preferences(p_candidature,prefs) then
    raise exception 'Dati o preferenze scolastiche non validi';
  end if;

  select array_agg(distinct trim(value) order by trim(value))
  into clean_comuni
  from unnest(coalesce(p_comuni,array[]::text[])) value
  where nullif(trim(value),'') is not null;

  if coalesce(cardinality(clean_comuni),0) not between 1 and 100 then
    raise exception 'I dati territoriali non sono validi';
  end if;

  select *
  into current_record
  from public.candidati
  where user_id=auth.uid()
  for update;

  target_id=current_record.id;

  if target_id is null then
    if jsonb_array_length(prefs)=0 then
      raise exception 'Aggiungi almeno una scuola';
    end if;

    select *
    into approved_request
    from public.candidate_registration_requests
    where user_id=auth.uid()
      and status='approved';

    if approved_request.id is null then
      raise exception 'La nuova iscrizione deve essere approvata da un amministratore';
    end if;

    if not exists(
      select 1
      from jsonb_to_recordset(p_candidature) as item(
        classe text,
        posizione integer,
        punteggio numeric
      )
      where item.classe=approved_request.classe
        and item.posizione=approved_request.posizione
        and round(item.punteggio,2)=round(approved_request.punteggio,2)
    ) then
      raise exception 'I dati iniziali non corrispondono alla richiesta approvata';
    end if;

    if public.registration_tuple_exists(
      approved_request.classe,
      approved_request.posizione,
      approved_request.punteggio,
      null
    ) then
      raise exception 'Esiste già un record compatibile: richiedine la rivendicazione';
    end if;

    insert into public.candidati(
      candidature,
      provincia_1,
      provincia_2,
      provincia_assegnata,
      comuni,
      user_id,
      preferenze_scuole,
      updated_at
    )
    values(
      p_candidature,
      clean_provincia_1,
      clean_provincia_2,
      clean_assigned,
      clean_comuni,
      auth.uid(),
      prefs,
      now()
    )
    returning id into target_id;

    return target_id;
  end if;

  update public.candidati
  set candidature=p_candidature,
      preferenze_scuole=prefs,
      provincia_assegnata=clean_assigned,
      provincia_1=clean_provincia_1,
      provincia_2=clean_provincia_2,
      comuni=clean_comuni,
      updated_at=now()
  where id=target_id;

  return target_id;
end;
$$;

revoke all on function public.upsert_my_candidatura_v2(
  jsonb,jsonb,text,text,text,text[]
) from public;

grant execute on function public.upsert_my_candidatura_v2(
  jsonb,jsonb,text,text,text,text[]
) to authenticated;

notify pgrst,'reload schema';

commit;
