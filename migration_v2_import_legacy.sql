-- Associazione delle vecchie compilazioni agli account esistenti.
-- Eseguire se migration_v2_accounts_schools.sql era già stata eseguita.

begin;


create or replace function public.link_legacy_submission_to_current_user(
  p_edit_code text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Accedi prima alla tua area personale';
  end if;

  if exists (
    select 1 from public.candidati where user_id = auth.uid()
  ) then
    raise exception 'Il tuo account possiede già una compilazione';
  end if;

  select t.candidate_id
    into target_id
  from public.candidati_edit_tokens t
  join public.candidati c on c.id = t.candidate_id
  where extensions.crypt(p_edit_code, t.token_hash) = t.token_hash
    and c.user_id is null
  limit 1;

  if target_id is null then
    return false;
  end if;

  update public.candidati
  set
    user_id = auth.uid(),
    preferenze_scuole = null,
    updated_at = now()
  where id = target_id
    and user_id is null;

  return found;
end;
$$;

revoke all on function public.link_legacy_submission_to_current_user(text) from public;
grant execute on function public.link_legacy_submission_to_current_user(text) to authenticated;

commit;
