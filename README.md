# Vincitori PNRR3 Basilicata Infanzia / Primaria

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


## Correzioni mappa, footer e menu account

- Corretto `loadSchoolsIndex()` come funzione asincrona: l'errore bloccava
  l'inizializzazione della mappa e delle altre funzioni della home.
- Ripristinato il footer condiviso con crediti e link amministrativo.
- Inserito uno spazio grafico esplicito tra il numero e il testo dei posti.
- Il menu mostra `Log in` senza sessione e `Il mio account` quando l'utente
  risulta autenticato tramite Supabase.


## Caricamento robusto della mappa

La mappa non dipende più da una sola risorsa esterna:

- Leaflet viene cercato prima su unpkg e poi su jsDelivr;
- il GeoJSON viene cercato prima localmente, poi su jsDelivr e infine su GitHub Raw;
- ogni richiesta ha un timeout;
- in caso di errore compare il pulsante `Riprova`;
- dopo il caricamento viene forzato il ricalcolo delle dimensioni della mappa.

È possibile rendere la mappa completamente autonoma aggiungendo alla root del
repository il file `limits_R_17_municipalities.geojson`; il codice lo userà
automaticamente come prima fonte.


## Popup della mappa

I popup comunali mostrano ora:

- numero di utenti che hanno espresso almeno una preferenza nel comune;
- posti ufficiali complessivi;
- confronto preferenze/posti per AAAA, ADAA, EEEE e ADEE;
- elenco delle scuole e dei plessi disponibili;
- indicazione dei posti aggregati per istituto/comune nell'Infanzia.

Per i nuovi account, le preferenze sono conteggiate sulla singola scuola e sulla
classe associata. Le vecchie compilazioni comunali restano incluse con la logica
storica.


## Versione 3: gestione autonoma e multi-amministratore

Eseguire `migration_v3_autonomia_admin.sql`.

Novità:

- i comuni nelle richieste vengono confrontati ignorando maiuscole, accenti,
  apostrofi, trattini e spazi;
- le richieste inviate dall'area personale sono collegate all'account;
- dopo l'approvazione il vecchio record appare automaticamente nell'account,
  senza passaggio di codici;
- nuovi inserimenti anonimi bloccati;
- un record per account;
- gestione di più amministratori dall'area admin;
- ricerca record, associazione a email e cancellazione;
- rilevazione di possibili duplicati per classe, posizione e punteggio.


## Correzione migrazione V3

La prima versione tentava di cambiare il tipo di ritorno di due RPC tramite
`CREATE OR REPLACE FUNCTION`, operazione non ammessa da PostgreSQL.

Usare `HOTFIX_migration_v3_autonomia_admin.sql`: elimina e ricrea soltanto le
due funzioni interessate, ripristina i permessi e aggiorna la schema cache di
PostgREST. Poiché la vecchia migrazione era racchiusa in una transazione, il
fallimento iniziale ha annullato anche la creazione di `admin_search_candidates`.


## Hotfix V3.1 — tipi di ritorno RPC

Eseguire `HOTFIX_v3_1_return_types.sql` se nelle sezioni Amministratori,
Record o Duplicati compare:

`structure of query does not match function result type`

La causa è la differenza tra `varchar` nelle tabelle Auth e `text` dichiarato
dalle RPC. La hotfix ricrea le funzioni con cast espliciti e ricarica la schema
cache di PostgREST.


## Hotfix V3.2 — ricerca avanzata, duplicati e record compatibili

Eseguire `HOTFIX_v3_2_admin_search_duplicates.sql`.

La hotfix:
- corregge i tipi restituiti da `admin_find_claim_candidates`;
- aggiunge una ricerca combinabile per ID, email, classe, posizione, punteggio,
  comune e stato di associazione;
- mostra automaticamente i gruppi di duplicati con dettaglio dei singoli record;
- consente di associare o eliminare un record direttamente dal gruppo duplicati.


## Hotfix V3.3 — duplicati e accesso amministrativo

- Corretto l'alias di `jsonb_array_elements()` nella funzione dei duplicati.
- L'area amministrativa usa ora il Magic Link e non richiede più password.
- Eseguire `HOTFIX_v3_3_duplicati.sql`.
- In Supabase Authentication aggiungere anche `admin.html` tra gli URL di
  redirect consentiti.


## Hotfix V3.4 — duplicati

La funzione dei duplicati è stata riscritta usando `jsonb_to_recordset()`.
Non utilizza più l'operatore `->>` e quindi evita l'errore
`operator does not exist: text ->> unknown`.

Eseguire `HOTFIX_v3_4_duplicati.sql` nel SQL Editor di Supabase.


## Identità indipendente

Lo stemma della Regione Basilicata è stato rimosso da tutte le pagine.
È stato sostituito da un marchio grafico neutro `P3` e da una nota visibile
che chiarisce che il progetto non è collegato a Ministero, USR, Regione o
altre amministrazioni pubbliche.


## Versione 4 — OTP e registrazione moderata

- accesso tramite codice OTP numerico;
- account nuovi consentiti;
- richiesta preventiva con classe, posizione e punteggio;
- blocco automatico se esiste già un record coincidente;
- approvazione o rifiuto dall'area amministrativa;
- nessuna modifica agli utenti e ai record già esistenti.

Eseguire `migration_v4_otp_registrazione_moderata.sql` e configurare il
template email Supabase affinché mostri `{{ .Token }}`.


## Versione 4.1 — correzione caricamento OTP

- cache busting per `account.js`, `admin.js` e `config.js`;
- CDN jsDelivr ufficialmente supportato da Supabase;
- caricamento differito e ordinato degli script;
- messaggi visibili in caso di risorsa o configurazione non caricata;
- gestione esplicita degli errori durante l’invio del codice.


## Versione 4.2

Accesso con Google e Microsoft aggiunto a `account.html` e `admin.html`; OTP email mantenuto come alternativa. Vedi `GUIDA_GOOGLE_MICROSOFT.txt`.


## Versione 4.3

Login Microsoft rimosso. Restano Google OAuth e OTP email.


## Versione 4.4 — assistenza manuale

Aggiunto un modulo pubblico per gli utenti che non riescono ad accedere con
Google o OTP e una coda di gestione nell’area amministrativa. Eseguire
`migration_v4_4_assistenza_manuale.sql`.


## Versione 4.5

Gestione diretta delle compilazioni dalle segnalazioni di assistenza: ricerca record coincidenti, collegamento e creazione amministrativa.


## Versione 4.6

Le segnalazioni raccolgono e salvano direttamente le scuole/plessi con disponibilità, ordinate dall’utente. Comuni e province vengono ricavati automaticamente solo per compatibilità interna.

## Versione 4.7

Gestione completa dei record dall’area amministrativa: selezione multipla,
eliminazione massiva, modifica di candidature, email e preferenze scolastiche.
Eseguire `migration_v4_7_admin_record_manager.sql`.

## Versione 4.8

La gestione dati è raccolta nella sezione **Record / Compilazioni**. Aggiunta
la funzione **Unisci duplicati**, con scelta del record principale, trasferimento
dell’account e fusione delle preferenze scolastiche.
