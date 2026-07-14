-- PNRR3 Basilicata V4.8
-- Sezione Record / Compilazioni e unione sicura dei duplicati.
-- Eseguire dopo la migrazione V4.7.

begin;

create or replace function public.admin_merge_duplicate_candidates(
  p_primary_candidate_id bigint,
  p_duplicate_candidate_ids bigint[]
)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare
  all_ids bigint[];
  expected_count integer;
  found_count integer;
  distinct_signatures integer;
  linked_user_count integer;
  linked_user uuid;
  merged_preferences jsonb;
  merged_comuni text[];
begin
  perform public.require_admin();

  if p_primary_candidate_id is null then
    raise exception 'Seleziona il record principale';
  end if;

  select array_agg(distinct id)
  into all_ids
  from unnest(
    array_append(
      coalesce(p_duplicate_candidate_ids,array[]::bigint[]),
      p_primary_candidate_id
    )
  ) id
  where id is not null;

  expected_count=coalesce(cardinality(all_ids),0);

  if expected_count<2 then
    raise exception 'Seleziona almeno due record da unire';
  end if;

  if expected_count>20 then
    raise exception 'Puoi unire al massimo 20 record per operazione';
  end if;

  if not (p_primary_candidate_id=any(all_ids)) then
    raise exception 'Il record principale non appartiene al gruppo';
  end if;

  -- Blocca tutti i record coinvolti per evitare modifiche concorrenti.
  perform 1
  from public.candidati
  where id=any(all_ids)
  order by id
  for update;

  get diagnostics found_count=row_count;

  if found_count<>expected_count then
    raise exception 'Uno o più record non esistono più';
  end if;

  -- Tutti i record devono avere esattamente la stessa firma:
  -- classe + posizione + punteggio per ciascuna candidatura.
  with signatures as (
    select
      c.id,
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
    where c.id=any(all_ids)
    group by c.id
  )
  select count(distinct signature)
  into distinct_signatures
  from signatures;

  if distinct_signatures<>1 then
    raise exception 'I record selezionati non sono duplicati esatti';
  end if;

  -- Può essere trasferita una sola identità utente.
  select count(distinct user_id)
  into linked_user_count
  from public.candidati
  where id=any(all_ids)
    and user_id is not null;

  if linked_user_count>1 then
    raise exception 'Il gruppo contiene record associati a account diversi: scegli manualmente quale conservare';
  end if;

  select user_id
  into linked_user
  from public.candidati
  where id=any(all_ids)
    and user_id is not null
  limit 1;

  -- Unisce le preferenze: prima quelle del record principale, poi quelle
  -- degli altri record, eliminando doppioni e conservando massimo 30 sedi.
  with source_preferences as (
    select
      c.id as candidate_id,
      case
        when c.id=p_primary_candidate_id then 0
        else array_position(all_ids,c.id)
      end as source_rank,
      pref.classe,
      pref.codice_scuola,
      pref.ordine
    from public.candidati c
    cross join lateral jsonb_to_recordset(
      coalesce(c.preferenze_scuole,'[]'::jsonb)
    ) as pref(
      classe text,
      codice_scuola text,
      ordine integer
    )
    where c.id=any(all_ids)
  ),
  unique_preferences as (
    select distinct on (classe,codice_scuola)
      classe,
      codice_scuola,
      source_rank,
      ordine
    from source_preferences
    order by classe,codice_scuola,source_rank,ordine
  ),
  ordered_preferences as (
    select
      classe,
      codice_scuola,
      row_number() over(
        order by source_rank,ordine,classe,codice_scuola
      )::integer as new_order
    from unique_preferences
    order by source_rank,ordine,classe,codice_scuola
    limit 30
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'classe',classe,
        'codice_scuola',codice_scuola,
        'ordine',new_order
      )
      order by new_order
    ),
    '[]'::jsonb
  )
  into merged_preferences
  from ordered_preferences;

  -- Mantiene anche i comuni storici, deduplicati, per compatibilità.
  with values_union as (
    select trim(value) as comune
    from public.candidati c
    cross join lateral unnest(coalesce(c.comuni,array[]::text[])) value
    where c.id=any(all_ids)
      and nullif(trim(value),'') is not null
  )
  select array_agg(comune order by comune)
  into merged_comuni
  from (
    select distinct comune
    from values_union
    order by comune
    limit 20
  ) q;

  update public.candidati
  set user_id=coalesce(linked_user,user_id),
      preferenze_scuole=merged_preferences,
      comuni=coalesce(
        merged_comuni,
        comuni,
        array['Preferenze scolastiche']::text[]
      ),
      updated_at=now()
  where id=p_primary_candidate_id;

  -- Sposta i riferimenti amministrativi al record conservato.
  if to_regclass('public.candidati_legacy_claims') is not null then
    execute
      'update public.candidati_legacy_claims
       set candidate_id=$1
       where candidate_id=any($2)
         and candidate_id<>$1'
    using p_primary_candidate_id,all_ids;
  end if;

  if to_regclass('public.manual_support_requests') is not null then
    execute
      'update public.manual_support_requests
       set candidate_id=$1,
           updated_at=now()
       where candidate_id=any($2)
         and candidate_id<>$1'
    using p_primary_candidate_id,all_ids;
  end if;

  -- I token anonimi dei record secondari vengono eliminati dalla FK
  -- ON DELETE CASCADE; il token del record principale resta invariato.
  delete from public.candidati
  where id=any(all_ids)
    and id<>p_primary_candidate_id;

  return p_primary_candidate_id;
end;
$$;

revoke all on function public.admin_merge_duplicate_candidates(
  bigint,bigint[]
) from public;

grant execute on function public.admin_merge_duplicate_candidates(
  bigint,bigint[]
) to authenticated;

notify pgrst,'reload schema';

commit;
