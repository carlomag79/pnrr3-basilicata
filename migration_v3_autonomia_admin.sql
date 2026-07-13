-- PNRR3 Basilicata V3
-- Autonomia utenti, richieste collegate all'account, multi-admin e gestione duplicati.
-- Eseguire dopo tutte le migrazioni precedenti.

begin;

create extension if not exists unaccent with schema extensions;

create or replace function public.normalize_lookup_text(p_value text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select regexp_replace(
    lower(extensions.unaccent(trim(coalesce(p_value, '')))),
    '[^a-z0-9]+',
    '',
    'g'
  );
$$;

alter table public.candidati_legacy_claims
  add column if not exists requester_user_id uuid references auth.users(id) on delete set null,
  add column if not exists requester_email text;

create unique index if not exists one_pending_claim_per_user
  on public.candidati_legacy_claims(requester_user_id)
  where requester_user_id is not null and status = 'pending';

-- Da questo momento i nuovi dati si inseriscono soltanto dall'area personale.
drop policy if exists "Inserimento pubblico anonimo" on public.candidati;
revoke insert on table public.candidati from anon;
revoke execute on function public.submit_candidatura(jsonb,text,text,text[],text) from anon;
revoke execute on function public.submit_legacy_claim_request(text,text,integer,numeric,text) from anon;

create or replace function public.submit_my_legacy_claim(
  p_classe text,
  p_posizione integer,
  p_punteggio numeric,
  p_primo_comune text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id bigint;
  current_email text;
begin
  if auth.uid() is null then
    raise exception 'Accedi prima alla tua area personale';
  end if;

  if exists (select 1 from public.candidati where user_id = auth.uid()) then
    raise exception 'Il tuo account possiede già una compilazione';
  end if;

  if p_classe not in ('AAAA','ADAA','EEEE','ADEE')
     or p_posizione < 1
     or p_punteggio < 0
     or nullif(trim(p_primo_comune), '') is null then
    raise exception 'Dati della richiesta non validi';
  end if;

  if exists (
    select 1 from public.candidati_legacy_claims
    where requester_user_id = auth.uid() and status = 'pending'
  ) then
    raise exception 'Hai già una richiesta in attesa';
  end if;

  select email into current_email
  from auth.users
  where id = auth.uid();

  insert into public.candidati_legacy_claims(
    request_hash,
    classe,
    posizione,
    punteggio,
    primo_comune,
    requester_user_id,
    requester_email
  )
  values(
    extensions.crypt(
      'ACCOUNT-' || auth.uid()::text || '-' || clock_timestamp()::text,
      extensions.gen_salt('bf', 10)
    ),
    p_classe,
    p_posizione,
    p_punteggio,
    trim(p_primo_comune),
    auth.uid(),
    current_email
  )
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.get_my_legacy_claim()
returns table(
  id bigint,
  status text,
  admin_note text,
  candidate_id bigint,
  created_at timestamptz,
  reviewed_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select c.id,c.status,c.admin_note,c.candidate_id,c.created_at,c.reviewed_at
  from public.candidati_legacy_claims c
  where c.requester_user_id = auth.uid()
  order by c.created_at desc
  limit 1;
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
  reviewed_at timestamptz,
  requester_user_id uuid,
  requester_email text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  return query
  select
    c.id,c.classe,c.posizione,c.punteggio,c.primo_comune,c.status,
    c.candidate_id,c.admin_note,c.created_at,c.reviewed_at,
    c.requester_user_id,c.requester_email
  from public.candidati_legacy_claims c
  where p_status = 'all' or c.status = p_status
  order by case when c.status='pending' then 0 else 1 end, c.created_at desc;
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
  where id = p_request_id;

  if claim_row.id is null then
    raise exception 'Richiesta non trovata';
  end if;

  return query
  select
    c.id,c.candidature,c.provincia_1,c.provincia_2,c.comuni,c.created_at,u.email
  from public.candidati c
  left join auth.users u on u.id = c.user_id
  where exists (
    select 1
    from jsonb_array_elements(c.candidature) item
    where item->>'classe' = claim_row.classe
      and (item->>'posizione')::integer = claim_row.posizione
      and round((item->>'punteggio')::numeric,2) = round(claim_row.punteggio,2)
  )
  and exists (
    select 1 from unnest(c.comuni) comune
    where public.normalize_lookup_text(comune)
      = public.normalize_lookup_text(claim_row.primo_comune)
  )
  order by
    case when c.user_id is null then 0 else 1 end,
    c.created_at asc;
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
declare
  claim_row public.candidati_legacy_claims%rowtype;
  generated_code text;
begin
  perform public.require_admin();

  select * into claim_row
  from public.candidati_legacy_claims
  where id = p_request_id
  for update;

  if claim_row.id is null or claim_row.status <> 'pending' then
    raise exception 'La richiesta non è più in attesa';
  end if;

  if claim_row.requester_user_id is not null then
    if exists (
      select 1 from public.candidati
      where user_id = claim_row.requester_user_id and id <> p_candidate_id
    ) then
      raise exception 'L’account possiede già un’altra compilazione';
    end if;

    update public.candidati
    set user_id = claim_row.requester_user_id,
        preferenze_scuole = null,
        updated_at = now()
    where id = p_candidate_id
      and (user_id is null or user_id = claim_row.requester_user_id);

    if not found then
      raise exception 'Il record è già associato a un altro account';
    end if;

    update public.candidati_legacy_claims
    set status='approved',
        candidate_id=p_candidate_id,
        edit_code=null,
        admin_note='Compilazione associata direttamente all’area personale.',
        reviewed_at=now()
    where id=p_request_id;

    return 'linked';
  end if;

  generated_code := public.approve_legacy_claim_request(p_request_id,p_candidate_id);
  return generated_code;
end;
$$;

-- Gestione amministratori.
create or replace function public.admin_list_users()
returns table(user_id uuid,email text,created_at timestamptz,is_current boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return query
  select a.user_id,u.email,a.created_at,(a.user_id=auth.uid())
  from public.admin_users a
  join auth.users u on u.id=a.user_id
  order by a.created_at;
end;
$$;

create or replace function public.admin_add_user_by_email(p_email text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare target_user uuid;
begin
  perform public.require_admin();

  select id into target_user
  from auth.users
  where lower(email)=lower(trim(p_email))
  limit 1;

  if target_user is null then
    raise exception 'L’utente deve prima registrarsi al sito con questa email';
  end if;

  insert into public.admin_users(user_id)
  values(target_user)
  on conflict(user_id) do nothing;

  return true;
end;
$$;

create or replace function public.admin_remove_user(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare admin_total integer;
begin
  perform public.require_admin();

  if p_user_id=auth.uid() then
    raise exception 'Non puoi rimuovere il tuo stesso account';
  end if;

  select count(*) into admin_total from public.admin_users;
  if admin_total <= 1 then
    raise exception 'Deve rimanere almeno un amministratore';
  end if;

  delete from public.admin_users where user_id=p_user_id;
  return found;
end;
$$;

-- Gestione record e duplicati.
create or replace function public.admin_search_candidates(p_query text default '')
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
    c.id,u.email,c.candidature,c.comuni,
    coalesce(jsonb_array_length(c.preferenze_scuole),0),
    c.created_at,c.updated_at
  from public.candidati c
  left join auth.users u on u.id=c.user_id
  where nullif(trim(p_query),'') is null
     or c.id::text = trim(p_query)
     or lower(coalesce(u.email,'')) like '%'||lower(trim(p_query))||'%'
     or c.candidature::text ilike '%'||trim(p_query)||'%'
     or array_to_string(c.comuni,' ') ilike '%'||trim(p_query)||'%'
  order by c.updated_at desc nulls last,c.created_at desc
  limit 200;
end;
$$;

create or replace function public.admin_find_possible_duplicates()
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
      c.id,
      u.email,
      string_agg(
        (item->>'classe')||':'||
        (item->>'posizione')||':'||
        to_char(round((item->>'punteggio')::numeric,2),'FM999999990.00'),
        '|'
        order by item->>'classe'
      ) as sig
    from public.candidati c
    cross join lateral jsonb_array_elements(c.candidature) item
    left join auth.users u on u.id=c.user_id
    group by c.id,u.email
  )
  select
    s.sig,
    array_agg(s.id order by s.id),
    array_agg(coalesce(s.email,'—') order by s.id),
    count(*)::integer
  from signatures s
  group by s.sig
  having count(*) > 1
  order by count(*) desc,s.sig;
end;
$$;

create or replace function public.admin_delete_candidate(p_candidate_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  delete from public.candidati where id=p_candidate_id;
  return found;
end;
$$;

create or replace function public.admin_link_candidate_to_email(
  p_candidate_id bigint,
  p_email text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare target_user uuid;
begin
  perform public.require_admin();

  select id into target_user from auth.users
  where lower(email)=lower(trim(p_email))
  limit 1;

  if target_user is null then
    raise exception 'Utente non registrato';
  end if;

  if exists(select 1 from public.candidati where user_id=target_user and id<>p_candidate_id) then
    raise exception 'L’utente possiede già un altro record';
  end if;

  update public.candidati
  set user_id=target_user,updated_at=now()
  where id=p_candidate_id
    and (user_id is null or user_id=target_user);

  if not found then
    raise exception 'Record già associato a un altro account';
  end if;

  return true;
end;
$$;

revoke all on function public.submit_my_legacy_claim(text,integer,numeric,text) from public;
revoke all on function public.get_my_legacy_claim() from public;
revoke all on function public.admin_list_users() from public;
revoke all on function public.admin_add_user_by_email(text) from public;
revoke all on function public.admin_remove_user(uuid) from public;
revoke all on function public.admin_search_candidates(text) from public;
revoke all on function public.admin_find_possible_duplicates() from public;
revoke all on function public.admin_delete_candidate(bigint) from public;
revoke all on function public.admin_link_candidate_to_email(bigint,text) from public;

grant execute on function public.submit_my_legacy_claim(text,integer,numeric,text) to authenticated;
grant execute on function public.get_my_legacy_claim() to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_add_user_by_email(text) to authenticated;
grant execute on function public.admin_remove_user(uuid) to authenticated;
grant execute on function public.admin_search_candidates(text) to authenticated;
grant execute on function public.admin_find_possible_duplicates() to authenticated;
grant execute on function public.admin_delete_candidate(bigint) to authenticated;
grant execute on function public.admin_link_candidate_to_email(bigint,text) to authenticated;

commit;
