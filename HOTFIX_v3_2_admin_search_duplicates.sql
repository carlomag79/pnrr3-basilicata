-- HOTFIX V3.2
-- Corregge Trova record compatibili, aggiunge ricerca avanzata e duplicati dettagliati.

begin;

drop function if exists public.admin_find_claim_candidates(bigint);
drop function if exists public.admin_search_candidates_advanced(bigint,text,text,integer,numeric,text,text);
drop function if exists public.admin_find_possible_duplicates_detailed();

create function public.admin_find_claim_candidates(
  p_request_id bigint
)
returns table (
  candidate_id bigint,
  candidature jsonb,
  provincia_1 text,
  provincia_2 text,
  comuni text[],
  created_at timestamptz,
  linked_email text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  claim_row public.candidati_legacy_claims%rowtype;
begin
  perform public.require_admin();

  select * into claim_row
  from public.candidati_legacy_claims
  where id=p_request_id;

  if claim_row.id is null then
    raise exception 'Richiesta non trovata';
  end if;

  return query
  select
    c.id::bigint,
    c.candidature::jsonb,
    c.provincia_1::text,
    c.provincia_2::text,
    c.comuni::text[],
    c.created_at::timestamptz,
    u.email::text
  from public.candidati c
  left join auth.users u on u.id=c.user_id
  where exists (
    select 1
    from jsonb_array_elements(c.candidature) item
    where (item->>'classe')::text=claim_row.classe::text
      and (item->>'posizione')::integer=claim_row.posizione
      and round((item->>'punteggio')::numeric,2)=round(claim_row.punteggio,2)
  )
  and exists (
    select 1
    from unnest(c.comuni) comune
    where public.normalize_lookup_text(comune)
      = public.normalize_lookup_text(claim_row.primo_comune)
  )
  order by
    case when c.user_id is null then 0 else 1 end,
    c.created_at asc;
end;
$$;

create function public.admin_search_candidates_advanced(
  p_candidate_id bigint default null,
  p_email text default null,
  p_classe text default null,
  p_posizione integer default null,
  p_punteggio numeric default null,
  p_comune text default null,
  p_linked_status text default 'all'
)
returns table(
  candidate_id bigint,
  email text,
  candidature jsonb,
  comuni text[],
  preferences_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  if p_linked_status not in ('all','linked','unlinked') then
    raise exception 'Filtro associazione non valido';
  end if;

  return query
  select
    c.id::bigint,
    u.email::text,
    c.candidature::jsonb,
    c.comuni::text[],
    coalesce(jsonb_array_length(c.preferenze_scuole),0)::integer,
    c.created_at::timestamptz,
    c.updated_at::timestamptz
  from public.candidati c
  left join auth.users u on u.id=c.user_id
  where (p_candidate_id is null or c.id=p_candidate_id)
    and (nullif(trim(p_email),'') is null
         or lower(coalesce(u.email::text,'')) like '%'||lower(trim(p_email))||'%')
    and (nullif(trim(p_classe),'') is null or exists(
      select 1 from jsonb_array_elements(c.candidature) item
      where item->>'classe'=p_classe
    ))
    and (p_posizione is null or exists(
      select 1 from jsonb_array_elements(c.candidature) item
      where (item->>'posizione')::integer=p_posizione
        and (nullif(trim(p_classe),'') is null or item->>'classe'=p_classe)
    ))
    and (p_punteggio is null or exists(
      select 1 from jsonb_array_elements(c.candidature) item
      where round((item->>'punteggio')::numeric,2)=round(p_punteggio,2)
        and (nullif(trim(p_classe),'') is null or item->>'classe'=p_classe)
    ))
    and (nullif(trim(p_comune),'') is null or exists(
      select 1 from unnest(c.comuni) comune
      where public.normalize_lookup_text(comune)
        = public.normalize_lookup_text(p_comune)
    ))
    and (
      p_linked_status='all'
      or (p_linked_status='linked' and c.user_id is not null)
      or (p_linked_status='unlinked' and c.user_id is null)
    )
  order by c.updated_at desc nulls last,c.created_at desc
  limit 300;
end;
$$;

create function public.admin_find_possible_duplicates_detailed()
returns table(
  signature text,
  record_count integer,
  records jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
  with record_signatures as (
    select
      c.id,
      c.user_id,
      c.candidature,
      c.comuni,
      c.preferenze_scuole,
      c.created_at,
      c.updated_at,
      u.email::text as email,
      string_agg(
        (
          item->>'classe'||':'||
          item->>'posizione'||':'||
          to_char(round((item->>'punteggio')::numeric,2),'FM999999990.00')
        )::text,
        '|'::text
        order by item->>'classe',item->>'posizione'
      )::text as sig
    from public.candidati c
    cross join lateral jsonb_array_elements(c.candidature) item
    left join auth.users u on u.id=c.user_id
    group by c.id,u.email
  ),
  duplicate_signatures as (
    select sig
    from record_signatures
    group by sig
    having count(*)>1
  )
  select
    rs.sig::text,
    count(*)::integer,
    jsonb_agg(
      jsonb_build_object(
        'candidate_id',rs.id,
        'email',rs.email,
        'comuni',to_jsonb(rs.comuni),
        'preferences_count',coalesce(jsonb_array_length(rs.preferenze_scuole),0),
        'created_at',rs.created_at,
        'updated_at',rs.updated_at
      )
      order by rs.id
    )::jsonb
  from record_signatures rs
  join duplicate_signatures ds on ds.sig=rs.sig
  group by rs.sig
  order by count(*) desc,rs.sig;
end;
$$;

revoke all on function public.admin_find_claim_candidates(bigint) from public;
revoke all on function public.admin_search_candidates_advanced(bigint,text,text,integer,numeric,text,text) from public;
revoke all on function public.admin_find_possible_duplicates_detailed() from public;

grant execute on function public.admin_find_claim_candidates(bigint) to authenticated;
grant execute on function public.admin_search_candidates_advanced(bigint,text,text,integer,numeric,text,text) to authenticated;
grant execute on function public.admin_find_possible_duplicates_detailed() to authenticated;

notify pgrst,'reload schema';

commit;
