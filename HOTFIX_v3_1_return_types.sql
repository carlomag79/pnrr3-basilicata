-- HOTFIX V3.1
-- Corregge "structure of query does not match function result type"
-- nelle sezioni Amministratori, Record e possibili duplicati.

begin;

drop function if exists public.admin_list_users();
drop function if exists public.admin_search_candidates(text);
drop function if exists public.admin_find_possible_duplicates();

create function public.admin_list_users()
returns table(
  user_id uuid,
  email text,
  created_at timestamptz,
  is_current boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
  select
    a.user_id::uuid,
    u.email::text,
    a.created_at::timestamptz,
    (a.user_id = auth.uid())::boolean
  from public.admin_users a
  join auth.users u on u.id = a.user_id
  order by a.created_at;
end;
$$;

create function public.admin_search_candidates(p_query text default '')
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

  return query
  select
    c.id::bigint,
    u.email::text,
    c.candidature::jsonb,
    c.comuni::text[],
    coalesce(jsonb_array_length(c.preferenze_scuole), 0)::integer,
    c.created_at::timestamptz,
    c.updated_at::timestamptz
  from public.candidati c
  left join auth.users u on u.id = c.user_id
  where nullif(trim(p_query), '') is null
     or c.id::text = trim(p_query)
     or lower(coalesce(u.email::text, '')) like '%' || lower(trim(p_query)) || '%'
     or c.candidature::text ilike '%' || trim(p_query) || '%'
     or array_to_string(c.comuni, ' ') ilike '%' || trim(p_query) || '%'
  order by c.updated_at desc nulls last, c.created_at desc
  limit 200;
end;
$$;

create function public.admin_find_possible_duplicates()
returns table(
  signature text,
  candidate_ids bigint[],
  emails text[],
  record_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
  with signatures as (
    select
      c.id::bigint as candidate_id,
      u.email::text as email,
      string_agg(
        (
          item->>'classe'
          || ':'
          || item->>'posizione'
          || ':'
          || to_char(
            round((item->>'punteggio')::numeric, 2),
            'FM999999990.00'
          )
        )::text,
        '|'::text
        order by item->>'classe'
      )::text as sig
    from public.candidati c
    cross join lateral jsonb_array_elements(c.candidature) item
    left join auth.users u on u.id = c.user_id
    group by c.id, u.email
  )
  select
    s.sig::text,
    array_agg(s.candidate_id order by s.candidate_id)::bigint[],
    array_agg(coalesce(s.email, '—'::text) order by s.candidate_id)::text[],
    count(*)::integer
  from signatures s
  group by s.sig
  having count(*) > 1
  order by count(*) desc, s.sig;
end;
$$;

revoke all on function public.admin_list_users() from public;
revoke all on function public.admin_search_candidates(text) from public;
revoke all on function public.admin_find_possible_duplicates() from public;

grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_search_candidates(text) to authenticated;
grant execute on function public.admin_find_possible_duplicates() to authenticated;

notify pgrst, 'reload schema';

commit;
