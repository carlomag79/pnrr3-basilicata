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


## Disponibilità ufficiali 2026/27

La versione include i prospetti della provincia di Matera per infanzia e primaria.

- `disponibilita.json` contiene le righe ufficiali e lo stato per provincia.
- I posti della primaria sono associati al codice del singolo plesso.
- I posti dell'infanzia sono associati ai plessi del medesimo istituto e comune, ma restano contrassegnati come dato aggregato.
- I posti Montessori, educazione motoria e istruzione per adulti non sono conteggiati come AAAA, ADAA, EEEE o ADEE.
- Per Potenza lo stato resta `in_attesa`.


## Eleggibilità basata sulle disponibilità

La stima integra ora:

- posizione nella graduatoria;
- candidature meglio posizionate presenti nel database;
- ordine del comune nelle preferenze;
- numero di posti ufficiali disponibili.

Per la provincia di Matera, i comuni e i plessi senza disponibilità per le classi selezionate vengono esclusi dal form e dai risultati. Per Potenza, finché i prospetti non sono pubblicati, le scelte restano provvisorie e la stima continua a basarsi sulle preferenze raccolte.

I posti aggregati dell'infanzia vengono conteggiati una sola volta a livello di istituto/comune, evitando di moltiplicarli per il numero dei plessi.


## Disponibilità della provincia di Potenza

Sono stati integrati i prospetti post mobilità 2026/27 per Infanzia e Primaria della provincia di Potenza.

Totali rilevanti per il progetto:

- AAAA: 50 posti comuni;
- ADAA: 7 posti di sostegno;
- EEEE: 254 posti comuni ordinari;
- ADEE: 8 posti di sostegno.

Restano separati 3 posti Montessori per l'Infanzia e 6 posti per l'istruzione degli adulti nella Primaria.

Ora entrambe le province hanno dati ufficiali pubblicati: form, verifica, pagina Scuole e calcolo di eleggibilità mostrano soltanto comuni e plessi con disponibilità per la classe selezionata.


## Versione 2: account e preferenze scolastiche

La compilazione principale avviene ora da `account.html` mediante Magic Link.
Le preferenze sono associate ai codici delle singole scuole/plessi e possono
essere aggiornate dall'utente autenticato.

La versione include inoltre:

- menu mobile a pannello fisso;

Eseguire `migration_v2_accounts_schools.sql` e seguire
`GUIDA_VERSIONE_2.txt`.


## Recupero delle compilazioni precedenti

La vecchia sezione pubblica di correzione è stata rimossa dalla home.

Dopo l'accesso a `account.html`, un utente senza compilazione può:

- importare direttamente un vecchio record tramite codice `PNRR3`;
- richiedere il codice tramite la procedura `CLAIM` se non lo possiede;
- associare definitivamente il record al proprio account.

Vengono recuperati classi, posizione e punteggio. Le vecchie preferenze comunali
non sono convertite automaticamente in plessi: l'utente deve selezionare le
scuole disponibili e salvare.

Se la migrazione V2 era già stata eseguita, lanciare anche:

`migration_v2_import_legacy.sql`
