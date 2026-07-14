-- PNRR3 Basilicata V4.11
-- Ricerca di tutti gli utenti registrati dall'amministrazione.
-- Eseguire dopo la migrazione V4.10.

begin;

create or replace function public.admin_search_registered_users(
  p_query text default null,
  p_linked_status text default 'all'
)
returns table(
  user_id uuid,
  email text,
  is_admin boolean,
  candidate_id bigint,
  candidature jsonb,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.require_admin();

  if p_linked_status not in ('all','linked','unlinked') then
    raise exception 'Filtro utenti non valido';
  end if;

  return query
  select
    u.id::uuid,
    u.email::text,
    exists(
      select 1
      from public.admin_users au
      where au.user_id = u.id
    ) as is_admin,
    c.id::bigint as candidate_id,
    c.candidature::jsonb,
    u.created_at::timestamptz,
    u.last_sign_in_at::timestamptz
  from auth.users u
  left join public.candidati c
    on c.user_id = u.id
  where
    (
      nullif(trim(p_query),'') is null
      or lower(coalesce(u.email,'')) like '%' || lower(trim(p_query)) || '%'
    )
    and (
      p_linked_status = 'all'
      or (p_linked_status = 'linked' and c.id is not null)
      or (p_linked_status = 'unlinked' and c.id is null)
    )
  order by
    case when c.id is not null then 0 else 1 end,
    u.created_at desc
  limit 500;
end;
$$;

revoke all on function public.admin_search_registered_users(text,text) from public;
grant execute on function public.admin_search_registered_users(text,text) to authenticated;

notify pgrst, 'reload schema';

commit;
