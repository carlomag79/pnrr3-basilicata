# PNRR3 Basilicata

Piccola web app open source per raccogliere e visualizzare in forma non nominativa le preferenze territoriali dei vincitori del concorso PNRR3 Infanzia e Primaria in Basilicata.

## Funzioni

- form anonimo;
- classi AAAA, ADAA, EEEE e ADEE;
- selezione ordinata fino a 20 comuni;
- tabella pubblica filtrabile;
- esportazione CSV;
- mappa comunale interattiva;
- dati salvati su Supabase.

## Configurazione

1. Crea un progetto Supabase.
2. Apri **SQL Editor**.
3. Incolla ed esegui il contenuto di `supabase.sql`.
4. Apri `config.js`.
5. Inserisci:
   - `SUPABASE_URL`;
   - `SUPABASE_KEY`, usando la **Publishable key** (`sb_publishable_...`) oppure la vecchia `anon public` key.
6. Carica tutti i file nel repository GitHub pubblico.
7. Attiva GitHub Pages da **Settings → Pages → Deploy from a branch → main / root**.

## Sicurezza

La chiave pubblicabile di Supabase è progettata per essere usata nel browser. La sicurezza dipende dalle policy Row Level Security definite in `supabase.sql`.

Non inserire mai nel repository:

- Secret key;
- service_role key;
- password del database.

## Dati geografici

I confini comunali vengono caricati dal progetto open source `openpolis/geojson-italy`, basato sui dati ISTAT e distribuito con licenza CC BY 4.0.

## Licenza

Codice distribuito con licenza MIT.
