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


## Pagina Scuole

La pagina `scuole.html` mostra i 411 plessi statali dell’infanzia e primari della Basilicata per l’anno scolastico 2026/2027.

File collegati:

- `scuole.json`: anagrafica completa dei plessi;
- `scuole-index.json`: indice compatto usato nella tabella delle eleggibilità;
- `scuole.js`: filtri, lista, mappa e geocodifica puntuale su richiesta;
- `scuole.css`: stile della pagina.

Le disponibilità AAAA, ADAA, EEEE e ADEE sono già predisposte nel dataset con valore `null` e potranno essere aggiornate quando saranno pubblicati i posti per singola scuola.


## Componenti condivisi

`site-shell.js` genera il menu responsive e il footer comuni a `index.html` e `scuole.html`.
`scuole-index.js` contiene l’indice leggero dei plessi usato dalla tabella delle eleggibilità senza richieste di rete aggiuntive.


## Dashboard, confronto e codici di modifica

La home include:

- dashboard riepilogativa;
- confronto rapido tra posizione, classe e comune;
- codice anonimo per aggiornare o cancellare le nuove compilazioni.

Prima di pubblicare questa versione eseguire in Supabase il file:

`migration_edit_codes_dashboard.sql`

Le compilazioni create prima della migrazione non possiedono un codice di modifica e continuano a essere gestibili soltanto dall'amministratore tramite Supabase.


## Rivendicazione delle compilazioni precedenti

Gli utenti che hanno compilato prima dell'introduzione dei codici possono inviare una richiesta anonima usando classe, posizione, punteggio e primo comune.

Prima di pubblicare questa funzione eseguire:

`migration_legacy_claims.sql`

Le richieste vengono approvate manualmente. Le query operative sono raccolte in:

`GUIDA_APPROVAZIONE_VECCHIE_COMPILAZIONI.txt`


## Area amministrativa

La repository include una pagina `admin.html` protetta tramite Supabase Auth.

Prima di utilizzarla:

1. eseguire `migration_admin_panel.sql`;
2. creare un utente in Supabase Authentication;
3. aggiungere il suo UUID alla tabella `public.admin_users`.

La procedura completa è descritta in `GUIDA_ADMIN_PANEL.txt`.
