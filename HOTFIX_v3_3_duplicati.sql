-- HOTFIX V3.3
-- Corregge:
-- ERROR: operator does not exist: text ->> unknown
-- nella ricerca dei possibili duplicati.

begin;

drop function if exists public.admin_find_possible_duplicates_detailed();

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
      c.id::bigint as candidate_id,
      c.user_id,
      c.candidature,
      c.comuni,
      c.preferenze_scuole,
      c.created_at,
      c.updated_at,
      u.email::text as email,
      string_agg(
        (
          elem.value->>'classe'
          || ':'
          || elem.value->>'posizione'
          || ':'
          || to_char(
            round((elem.value->>'punteggio')::numeric, 2),
            'FM999999990.00'
          )
        )::text,
        '|'::text
        order by
          elem.value->>'classe',
          (elem.value->>'posizione')::integer
      )::text as sig
    from public.candidati c
    cross join lateral jsonb_array_elements(c.candidature)
      as elem(value)
    left join auth.users u on u.id = c.user_id
    group by
      c.id,
      c.user_id,
      c.candidature,
      c.comuni,
      c.preferenze_scuole,
      c.created_at,
      c.updated_at,
      u.email
  ),
  duplicate_signatures as (
    select rs.sig
    from record_signatures rs
    group by rs.sig
    having count(*) > 1
  )
  select
    rs.sig::text,
    count(*)::integer,
    jsonb_agg(
      jsonb_build_object(
        'candidate_id', rs.candidate_id,
        'email', rs.email,
        'comuni', to_jsonb(rs.comuni),
        'preferences_count',
          coalesce(jsonb_array_length(rs.preferenze_scuole), 0),
        'created_at', rs.created_at,
        'updated_at', rs.updated_at
      )
      order by rs.candidate_id
    )::jsonb
  from record_signatures rs
  join duplicate_signatures ds on ds.sig = rs.sig
  group by rs.sig
  order by count(*) desc, rs.sig;
end;
$$;

revoke all on function public.admin_find_possible_duplicates_detailed()
  from public;

grant execute on function public.admin_find_possible_duplicates_detailed()
  to authenticated;

notify pgrst, 'reload schema';

commit;
