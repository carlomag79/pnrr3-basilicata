-- PNRR3 Basilicata V4.15 — pagina pubblica Assegnazioni
begin;

create or replace function public.get_public_official_assignments()
returns table(
  insegnamento text,
  graduatoria text,
  posizione integer,
  punteggio numeric,
  esito text,
  provincia_assegnata text,
  codice_scuola text,
  denominazione_scuola text,
  nomina_coe boolean
)
language sql
security definer
set search_path=public
as $$
  select
    a.insegnamento,
    a.graduatoria,
    a.posizione,
    a.punteggio,
    a.esito,
    a.provincia_assegnata,
    a.codice_scuola,
    a.denominazione_scuola,
    a.nomina_coe
  from public.official_assignments a
  order by
    case a.insegnamento
      when 'AAAA' then 1
      when 'ADAA' then 2
      when 'EEEE' then 3
      when 'ADEE' then 4
      else 5
    end,
    a.posizione,
    a.punteggio desc;
$$;

revoke all on function public.get_public_official_assignments() from public;
grant execute on function public.get_public_official_assignments()
to anon,authenticated;

notify pgrst,'reload schema';
commit;
