-- PNRR3 Basilicata V4.10
-- Stati di pubblicazione e filtro per preferenze scolastiche.
-- Eseguire dopo la migrazione V4.9.

begin;

drop function if exists public.admin_search_candidates_advanced(
  bigint,text,text,integer,numeric,text,text
);

create or replace function public.admin_search_candidates_advanced(
  p_candidate_id bigint default null,
  p_email text default null,
  p_classe text default null,
  p_posizione integer default null,
  p_punteggio numeric default null,
  p_comune text default null,
  p_linked_status text default 'all',
  p_preferences_status text default 'all'
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
set search_path=public
as $$
begin
  perform public.require_admin();

  if p_linked_status not in ('all','linked','unlinked') then
    raise exception 'Filtro associazione non valido';
  end if;

  if p_preferences_status not in ('all','present','missing') then
    raise exception 'Filtro preferenze non valido';
  end if;

  return query
  select
    c.id::bigint,
    u.email::text,
    c.candidature::jsonb,
    c.comuni::text[],
    case
      when jsonb_typeof(c.preferenze_scuole)='array'
        then jsonb_array_length(c.preferenze_scuole)
      else 0
    end::integer,
    c.created_at::timestamptz,
    c.updated_at::timestamptz
  from public.candidati c
  left join auth.users u on u.id=c.user_id
  where (p_candidate_id is null or c.id=p_candidate_id)
    and (
      nullif(trim(p_email),'') is null
      or lower(coalesce(u.email::text,'')) like '%'||lower(trim(p_email))||'%'
    )
    and (
      nullif(trim(p_classe),'') is null
      or exists(
        select 1
        from jsonb_array_elements(c.candidature) item
        where item->>'classe'=p_classe
      )
    )
    and (
      p_posizione is null
      or exists(
        select 1
        from jsonb_array_elements(c.candidature) item
        where (item->>'posizione')::integer=p_posizione
          and (
            nullif(trim(p_classe),'') is null
            or item->>'classe'=p_classe
          )
      )
    )
    and (
      p_punteggio is null
      or exists(
        select 1
        from jsonb_array_elements(c.candidature) item
        where round((item->>'punteggio')::numeric,2)=round(p_punteggio,2)
          and (
            nullif(trim(p_classe),'') is null
            or item->>'classe'=p_classe
          )
      )
    )
    and (
      nullif(trim(p_comune),'') is null
      or exists(
        select 1
        from unnest(c.comuni) comune
        where public.normalize_lookup_text(comune)
          =public.normalize_lookup_text(p_comune)
      )
    )
    and (
      p_linked_status='all'
      or (p_linked_status='linked' and c.user_id is not null)
      or (p_linked_status='unlinked' and c.user_id is null)
    )
    and (
      p_preferences_status='all'
      or (
        p_preferences_status='present'
        and jsonb_typeof(c.preferenze_scuole)='array'
        and jsonb_array_length(c.preferenze_scuole)>0
      )
      or (
        p_preferences_status='missing'
        and (
          c.preferenze_scuole is null
          or jsonb_typeof(c.preferenze_scuole)<>'array'
          or jsonb_array_length(c.preferenze_scuole)=0
        )
      )
    )
  order by c.updated_at desc nulls last,c.created_at desc
  limit 300;
end;
$$;

revoke all on function public.admin_search_candidates_advanced(
  bigint,text,text,integer,numeric,text,text,text
) from public;

grant execute on function public.admin_search_candidates_advanced(
  bigint,text,text,integer,numeric,text,text,text
) to authenticated;

notify pgrst,'reload schema';

commit;
