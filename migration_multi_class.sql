-- Esegui questo file SOLO se la tabella candidati esiste già
-- nella versione con una singola classe di concorso.

alter table public.candidati
  add column if not exists candidature jsonb;

update public.candidati
set candidature = jsonb_build_array(
  jsonb_build_object(
    'classe', classe_concorso,
    'posizione', posizione,
    'punteggio', punteggio
  )
)
where candidature is null
  and classe_concorso is not null;

alter table public.candidati
  alter column candidature set not null;

alter table public.candidati
  alter column classe_concorso drop not null,
  alter column posizione drop not null,
  alter column punteggio drop not null;

alter table public.candidati
  drop constraint if exists candidati_classe_concorso_check,
  drop constraint if exists candidati_posizione_check,
  drop constraint if exists candidati_punteggio_check;

alter table public.candidati
  drop constraint if exists candidature_valide;

alter table public.candidati
  add constraint candidature_valide check (
    jsonb_typeof(candidature) = 'array'
    and jsonb_array_length(candidature) between 1 and 4
  );

drop policy if exists "Inserimento pubblico anonimo" on public.candidati;

create policy "Inserimento pubblico anonimo"
on public.candidati
for insert
to anon, authenticated
with check (
  jsonb_typeof(candidature) = 'array'
  and jsonb_array_length(candidature) between 1 and 4
  and provincia_1 in ('Potenza', 'Matera')
  and (provincia_2 is null or provincia_2 in ('Potenza', 'Matera'))
  and (provincia_2 is null or provincia_2 <> provincia_1)
  and cardinality(comuni) between 1 and 20
);

grant select, insert on table public.candidati to anon, authenticated;
