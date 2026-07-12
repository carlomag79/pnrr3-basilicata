-- PNRR3 Basilicata
-- Codici anonimi per modificare e cancellare le compilazioni.
-- Eseguire una sola volta in Supabase → SQL Editor.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.candidati_edit_tokens (
  candidate_id bigint primary key
    references public.candidati(id)
    on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.candidati_edit_tokens enable row level security;

-- Nessuna policy pubblica: gli hash non devono essere leggibili dal frontend.
revoke all on table public.candidati_edit_tokens from anon, authenticated;

drop policy if exists "Inserimento pubblico anonimo" on public.candidati;
revoke insert, update, delete on public.candidati from anon, authenticated;

create or replace function public.validate_candidate_payload(
  p_candidature jsonb,
  p_provincia_1 text,
  p_provincia_2 text,
  p_comuni text[]
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    jsonb_typeof(p_candidature) = 'array'
    and jsonb_array_length(p_candidature) between 1 and 4
    and p_provincia_1 in ('Potenza', 'Matera')
    and (p_provincia_2 is null or p_provincia_2 in ('Potenza', 'Matera'))
    and (p_provincia_2 is null or p_provincia_2 <> p_provincia_1)
    and cardinality(p_comuni) between 1 and 20
    and not exists (
      select 1
      from jsonb_array_elements(p_candidature) as item
      where
        item->>'classe' not in ('AAAA', 'ADAA', 'EEEE', 'ADEE')
        or coalesce((item->>'posizione') ~ '^[0-9]+$', false) = false
        or (item->>'posizione')::integer < 1
        or coalesce((item->>'punteggio') ~ '^[0-9]+([.][0-9]+)?$', false) = false
        or (item->>'punteggio')::numeric < 0
    );
$$;

create or replace function public.submit_candidatura(
  p_candidature jsonb,
  p_provincia_1 text,
  p_provincia_2 text,
  p_comuni text[],
  p_edit_code text
)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  new_id bigint;
begin
  if not public.validate_candidate_payload(
    p_candidature,
    p_provincia_1,
    p_provincia_2,
    p_comuni
  ) then
    raise exception 'Dati della candidatura non validi';
  end if;

  if p_edit_code !~ '^PNRR3-[A-Z0-9]{4}-[A-Z0-9]{4}$' then
    raise exception 'Codice di modifica non valido';
  end if;

  insert into public.candidati (
    candidature,
    provincia_1,
    provincia_2,
    comuni
  )
  values (
    p_candidature,
    p_provincia_1,
    p_provincia_2,
    p_comuni
  )
  returning id into new_id;

  insert into public.candidati_edit_tokens (
    candidate_id,
    token_hash
  )
  values (
    new_id,
    extensions.crypt(p_edit_code, extensions.gen_salt('bf', 10))
  );

  return new_id;
end;
$$;

create or replace function public.get_my_submission(
  p_edit_code text
)
returns table (
  id bigint,
  candidature jsonb,
  provincia_1 text,
  provincia_2 text,
  comuni text[]
)
language sql
security definer
set search_path = public, extensions
as $$
  select
    c.id,
    c.candidature,
    c.provincia_1,
    c.provincia_2,
    c.comuni
  from public.candidati c
  join public.candidati_edit_tokens t
    on t.candidate_id = c.id
  where extensions.crypt(p_edit_code, t.token_hash) = t.token_hash
  limit 1;
$$;

create or replace function public.update_my_submission(
  p_edit_code text,
  p_candidature jsonb,
  p_provincia_1 text,
  p_provincia_2 text,
  p_comuni text[]
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_id bigint;
begin
  if not public.validate_candidate_payload(
    p_candidature,
    p_provincia_1,
    p_provincia_2,
    p_comuni
  ) then
    raise exception 'Dati della candidatura non validi';
  end if;

  select t.candidate_id
    into target_id
  from public.candidati_edit_tokens t
  where extensions.crypt(p_edit_code, t.token_hash) = t.token_hash
  limit 1;

  if target_id is null then
    return false;
  end if;

  update public.candidati
  set
    candidature = p_candidature,
    provincia_1 = p_provincia_1,
    provincia_2 = p_provincia_2,
    comuni = p_comuni
  where id = target_id;

  return found;
end;
$$;

create or replace function public.delete_my_submission(
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
  select t.candidate_id
    into target_id
  from public.candidati_edit_tokens t
  where extensions.crypt(p_edit_code, t.token_hash) = t.token_hash
  limit 1;

  if target_id is null then
    return false;
  end if;

  delete from public.candidati
  where id = target_id;

  return found;
end;
$$;

revoke all on function public.validate_candidate_payload(jsonb, text, text, text[]) from public;
revoke all on function public.submit_candidatura(jsonb, text, text, text[], text) from public;
revoke all on function public.get_my_submission(text) from public;
revoke all on function public.update_my_submission(text, jsonb, text, text, text[]) from public;
revoke all on function public.delete_my_submission(text) from public;

grant execute on function public.submit_candidatura(jsonb, text, text, text[], text)
  to anon, authenticated;
grant execute on function public.get_my_submission(text)
  to anon, authenticated;
grant execute on function public.update_my_submission(text, jsonb, text, text, text[])
  to anon, authenticated;
grant execute on function public.delete_my_submission(text)
  to anon, authenticated;

commit;
