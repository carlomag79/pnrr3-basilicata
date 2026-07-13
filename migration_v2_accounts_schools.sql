-- PNRR3 Basilicata v2
-- Account leggeri e preferenze per scuola.
-- Eseguire dopo tutte le migrazioni precedenti.

begin;

alter table public.candidati
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists preferenze_scuole jsonb,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists candidati_user_id_unique
  on public.candidati(user_id)
  where user_id is not null;


create or replace function public.validate_school_preferences(
  p_candidature jsonb,
  p_preferenze jsonb
)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    jsonb_typeof(p_candidature)='array'
    and jsonb_array_length(p_candidature) between 1 and 4
    and jsonb_typeof(p_preferenze)='array'
    and jsonb_array_length(p_preferenze) between 1 and 30
    and not exists (
      select 1 from jsonb_array_elements(p_preferenze) p
      where
        p->>'classe' not in ('AAAA','ADAA','EEEE','ADEE')
        or coalesce(p->>'codice_scuola','') !~ '^[A-Z0-9]{10}$'
        or coalesce((p->>'ordine') ~ '^[0-9]+$',false)=false
    );
$$;

create or replace function public.get_my_candidatura_v2()
returns table (
  id bigint,
  candidature jsonb,
  preferenze_scuole jsonb,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select c.id,c.candidature,c.preferenze_scuole,c.updated_at
  from public.candidati c
  where c.user_id=auth.uid()
  limit 1;
$$;

create or replace function public.upsert_my_candidatura_v2(
  p_candidature jsonb,
  p_preferenze_scuole jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare target_id bigint;
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  if not public.validate_school_preferences(p_candidature,p_preferenze_scuole) then
    raise exception 'Dati o preferenze scolastiche non validi';
  end if;

  select id into target_id from public.candidati where user_id=auth.uid();

  if target_id is null then
    insert into public.candidati(
      candidature,provincia_1,provincia_2,comuni,user_id,preferenze_scuole,updated_at
    ) values (
      p_candidature,'Potenza',null,array['Preferenze scolastiche'],auth.uid(),
      p_preferenze_scuole,now()
    ) returning id into target_id;
  else
    update public.candidati set
      candidature=p_candidature,
      preferenze_scuole=p_preferenze_scuole,
      updated_at=now()
    where id=target_id;
  end if;
  return target_id;
end;
$$;

create or replace function public.delete_my_candidatura_v2()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  delete from public.candidati where user_id=auth.uid();
  return found;
end;
$$;



revoke all on function public.get_my_candidatura_v2() from public;
revoke all on function public.upsert_my_candidatura_v2(jsonb,jsonb) from public;
revoke all on function public.delete_my_candidatura_v2() from public;

grant execute on function public.get_my_candidatura_v2() to authenticated;
grant execute on function public.upsert_my_candidatura_v2(jsonb,jsonb) to authenticated;
grant execute on function public.delete_my_candidatura_v2() to authenticated;

commit;

-- In Supabase → Authentication → URL Configuration:
-- aggiungi tra i Redirect URLs:
-- https://TUO-DOMINIO/account.html
