-- HOTFIX V3.4
-- Riscrive completamente la rilevazione dei duplicati senza usare
-- l'operatore JSON ->>, evitando l'errore:
-- operator does not exist: text ->> unknown

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
  with candidature_rows as (
    select
      c.id::bigint as candidate_id,
      c.comuni::text[] as comuni,
      c.preferenze_scuole::jsonb as preferenze_scuole,
      c.created_at::timestamptz as created_at,
      c.updated_at::timestamptz as updated_at,
      u.email::text as email,
      j.classe::text as classe,
      j.posizione::integer as posizione,
      round(j.punteggio::numeric, 2) as punteggio
    from public.candidati c
    cross join lateral jsonb_to_recordset(c.candidature) as j(
      classe text,
      posizione integer,
      punteggio numeric
    )
    left join auth.users u on u.id = c.user_id
  ),
  record_signatures as (
    select
      r.candidate_id,
      r.comuni,
      r.preferenze_scuole,
      r.created_at,
      r.updated_at,
      r.email,
      string_agg(
        concat(
          r.classe,
          ':',
          r.posizione::text,
          ':',
          to_char(r.punteggio, 'FM999999990.00')
        ),
        '|'
        order by r.classe, r.posizione, r.punteggio
      )::text as sig
    from candidature_rows r
    group by
      r.candidate_id,
      r.comuni,
      r.preferenze_scuole,
      r.created_at,
      r.updated_at,
      r.email
  ),
  duplicate_groups as (
    select
      rs.sig
    from record_signatures rs
    group by rs.sig
    having count(*) > 1
  )
  select
    rs.sig::text as signature,
    count(*)::integer as record_count,
    jsonb_agg(
      jsonb_build_object(
        'candidate_id', rs.candidate_id,
        'email', rs.email,
        'comuni', coalesce(to_jsonb(rs.comuni), '[]'::jsonb),
        'preferences_count',
          case
            when jsonb_typeof(rs.preferenze_scuole) = 'array'
              then jsonb_array_length(rs.preferenze_scuole)
            else 0
          end,
        'created_at', rs.created_at,
        'updated_at', rs.updated_at
      )
      order by rs.candidate_id
    )::jsonb as records
  from record_signatures rs
  inner join duplicate_groups dg on dg.sig = rs.sig
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
