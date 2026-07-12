-- PNRR3 Basilicata
-- Area amministrativa protetta tramite Supabase Auth.
-- Eseguire dopo migration_legacy_claims.sql.

begin;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
revoke all on table public.admin_users from anon, authenticated;

create or replace function public.admin_is_current_user()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

create or replace function public.require_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.admin_is_current_user() then
    raise exception 'Accesso amministratore non autorizzato';
  end if;
end;
$$;

create or replace function public.admin_claim_counts()
returns table (
  pending_count bigint,
  approved_count bigint,
  rejected_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
  select
    count(*) filter (where status = 'pending')::bigint,
    count(*) filter (where status = 'approved')::bigint,
    count(*) filter (where status = 'rejected')::bigint
  from public.candidati_legacy_claims;
end;
$$;

create or replace function public.admin_list_legacy_claims(
  p_status text default 'pending'
)
returns table (
  id bigint,
  classe text,
  posizione integer,
  punteggio numeric,
  primo_comune text,
  status text,
  candidate_id bigint,
  admin_note text,
  created_at timestamptz,
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
    c.id,
    c.classe,
    c.posizione,
    c.punteggio,
    c.primo_comune,
    c.status,
    c.candidate_id,
    c.admin_note,
    c.created_at,
    c.reviewed_at
  from public.candidati_legacy_claims c
  where p_status = 'all' or c.status = p_status
  order by
    case when c.status = 'pending' then 0 else 1 end,
    c.created_at desc;
end;
$$;

create or replace function public.admin_find_claim_candidates(
  p_request_id bigint
)
returns table (
  candidate_id bigint,
  candidature jsonb,
  provincia_1 text,
  provincia_2 text,
  comuni text[],
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  claim_row public.candidati_legacy_claims%rowtype;
begin
  perform public.require_admin();

  select *
  into claim_row
  from public.candidati_legacy_claims
  where id = p_request_id;

  if claim_row.id is null then
    raise exception 'Richiesta non trovata';
  end if;

  return query
  select
    c.id,
    c.candidature,
    c.provincia_1,
    c.provincia_2,
    c.comuni,
    c.created_at
  from public.candidati c
  where exists (
    select 1
    from jsonb_array_elements(c.candidature) as item
    where
      item->>'classe' = claim_row.classe
      and (item->>'posizione')::integer = claim_row.posizione
      and (item->>'punteggio')::numeric = claim_row.punteggio
  )
  and lower(trim(c.comuni[1])) = lower(trim(claim_row.primo_comune))
  order by c.created_at asc;
end;
$$;

create or replace function public.admin_approve_legacy_claim(
  p_request_id bigint,
  p_candidate_id bigint
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return public.approve_legacy_claim_request(p_request_id, p_candidate_id);
end;
$$;

create or replace function public.admin_reject_legacy_claim(
  p_request_id bigint,
  p_admin_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return public.reject_legacy_claim_request(p_request_id, p_admin_note);
end;
$$;

revoke all on function public.admin_is_current_user() from public;
revoke all on function public.require_admin() from public;
revoke all on function public.admin_claim_counts() from public;
revoke all on function public.admin_list_legacy_claims(text) from public;
revoke all on function public.admin_find_claim_candidates(bigint) from public;
revoke all on function public.admin_approve_legacy_claim(bigint, bigint) from public;
revoke all on function public.admin_reject_legacy_claim(bigint, text) from public;

grant execute on function public.admin_is_current_user() to authenticated;
grant execute on function public.admin_claim_counts() to authenticated;
grant execute on function public.admin_list_legacy_claims(text) to authenticated;
grant execute on function public.admin_find_claim_candidates(bigint) to authenticated;
grant execute on function public.admin_approve_legacy_claim(bigint, bigint) to authenticated;
grant execute on function public.admin_reject_legacy_claim(bigint, text) to authenticated;

commit;

-- DOPO AVER CREATO L'UTENTE IN:
-- Supabase → Authentication → Users → Add user
--
-- Recupera il suo UUID ed esegui:
--
-- insert into public.admin_users (user_id)
-- values ('INCOLLA-QUI-UUID-UTENTE');
