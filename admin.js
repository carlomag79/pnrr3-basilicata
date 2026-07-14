if (!window.supabase || typeof window.supabase.createClient !== "function") {
  const startupMessage = document.getElementById("admin-login-message");
  if (startupMessage) startupMessage.textContent = "La libreria di accesso non è stata caricata. Ricarica la pagina con Ctrl + F5.";
  throw new Error("Supabase JS non disponibile");
}

if (!window.APP_CONFIG?.SUPABASE_URL || !window.APP_CONFIG?.SUPABASE_KEY) {
  const startupMessage = document.getElementById("admin-login-message");
  if (startupMessage) startupMessage.textContent = "Configurazione Supabase non disponibile. Ricarica la pagina.";
  throw new Error("Configurazione Supabase mancante");
}

const adminConfig = window.APP_CONFIG || {};
const adminSupabase = window.supabase.createClient(
  adminConfig.SUPABASE_URL,
  adminConfig.SUPABASE_KEY
);

let adminRequests = [];
let pendingAdminOtpEmail = "";
let adminSchools = [];
let adminRecordsCache = [];
const selectedAdminRecordIds = new Set();
let editingAdminRecord = null;
let editingAdminPreferences = [];
let creatingAdminPreferences = [];
let preregisteredUsersCache = [];

const loginPanel = document.querySelector("#admin-login-panel");
const adminApp = document.querySelector("#admin-app");
const logoutButton = document.querySelector("#admin-logout");

function adminEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function adminDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("it-IT", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function statusLabel(status) {
  return {
    pending: "In attesa",
    approved: "Approvata",
    rejected: "Rifiutata",
    in_progress: "In lavorazione",
    resolved: "Risolta",
    dismissed: "Archiviata"
  }[status] || status;
}

async function verifyAdmin() {
  const { data, error } = await adminSupabase.rpc("admin_is_current_user");
  if (error) throw error;
  return Boolean(data);
}

async function handleSession(session) {
  if (!session) {
    loginPanel.hidden = false;
    adminApp.hidden = true;
    logoutButton.hidden = true;
    return;
  }

  try {
    const isAdmin = await verifyAdmin();
    if (!isAdmin) {
      await adminSupabase.auth.signOut();
      throw new Error("Questo account non è autorizzato come amministratore.");
    }

    loginPanel.hidden = true;
    adminApp.hidden = false;
    logoutButton.hidden = false;
    await Promise.all([loadAdminRequests(), loadManualSupportRequests(), loadRegistrationRequests(), loadPreregisteredUsers(), loadAdminUsers(), loadAdminRecords(), loadDuplicates()]);
  } catch (error) {
    loginPanel.hidden = false;
    adminApp.hidden = true;
    logoutButton.hidden = true;
    document.querySelector("#admin-login-message").textContent = error.message;
  }
}

async function loadAdminRequests() {
  const status = document.querySelector("#admin-status").value;
  const root = document.querySelector("#admin-requests");
  root.innerHTML = '<p class="admin-empty">Caricamento richieste…</p>';

  const { data, error } = await adminSupabase.rpc("admin_list_legacy_claims", {
    p_status: status
  });

  if (error) {
    root.innerHTML = `<p class="admin-empty">${adminEscape(error.message)}</p>`;
    return;
  }

  adminRequests = data || [];
  updateAdminStats();
  renderAdminRequests();
}

function updateAdminStats() {
  const counts = { pending: 0, approved: 0, rejected: 0 };

  // Always request aggregate counts separately so filter doesn't distort them.
  adminSupabase.rpc("admin_claim_counts").then(({ data, error }) => {
    if (error || !data) return;
    const row = Array.isArray(data) ? data[0] : data;
    document.querySelector("#admin-pending-count").textContent = row.pending_count || 0;
    document.querySelector("#admin-approved-count").textContent = row.approved_count || 0;
    document.querySelector("#admin-rejected-count").textContent = row.rejected_count || 0;
  });
}

function renderAdminRequests() {
  const root = document.querySelector("#admin-requests");

  if (!adminRequests.length) {
    root.innerHTML = '<p class="admin-empty">Nessuna richiesta per questo filtro.</p>';
    return;
  }

  root.innerHTML = adminRequests.map(request => `
    <article class="admin-request" data-request-id="${request.id}" data-status="${request.status}">
      <header class="admin-request__head">
        <div>
          <h2>Richiesta #${request.id}</h2>
          <p>Ricevuta ${adminDate(request.created_at)}</p>
        </div>
        <span class="admin-request__status">${statusLabel(request.status)}</span>
      </header>
      <div class="admin-request__body">
        <div class="admin-request__facts">
          <div class="admin-fact"><span>Classe</span><strong>${adminEscape(request.classe)}</strong></div>
          <div class="admin-fact"><span>Posizione</span><strong>${request.posizione}</strong></div>
          <div class="admin-fact"><span>Punteggio</span><strong>${Number(request.punteggio).toLocaleString("it-IT", { minimumFractionDigits: 2 })}</strong></div>
          <div class="admin-fact"><span>Primo comune</span><strong>${adminEscape(request.primo_comune)}</strong></div>
        </div>

        ${request.admin_note ? `<p class="admin-note"><strong>Nota:</strong> ${adminEscape(request.admin_note)}</p>` : ""}

        ${request.status === "pending" ? `
          <div class="admin-request__actions">
            <button class="secondary admin-find-matches" type="button">Trova record compatibili</button>
            <button class="primary admin-create-from-claim" type="button">Crea compilazione</button>
            <button class="danger-button admin-reject" type="button">Rifiuta</button>
          </div>
          <div class="admin-matches" hidden></div>
        ` : `
          <p class="admin-note">Esaminata ${adminDate(request.reviewed_at)}${request.candidate_id ? ` · Record associato: #${request.candidate_id}` : ""}</p>
        `}
      </div>
    </article>
  `).join("");
}

async function findMatches(requestId, article) {
  const matchesRoot = article.querySelector(".admin-matches");
  matchesRoot.hidden = false;
  matchesRoot.innerHTML = '<p class="admin-empty">Ricerca dei record compatibili…</p>';

  const { data, error } = await adminSupabase.rpc("admin_find_claim_candidates", {
    p_request_id: requestId
  });

  if (error) {
    matchesRoot.innerHTML = `<p class="admin-empty">${adminEscape(error.message)}</p>`;
    return;
  }

  const matches = data || [];
  if (!matches.length) {
    matchesRoot.innerHTML = '<p class="admin-empty">Nessun record corrispondente trovato. Puoi creare direttamente la compilazione da questa richiesta.</p>';
    return;
  }

  matchesRoot.innerHTML = matches.map((match, index) => `
    <label class="admin-match">
      <input type="radio" name="candidate-${requestId}" value="${match.candidate_id}" ${index === 0 ? "checked" : ""}>
      <span class="admin-match__main">
        <strong>Record #${match.candidate_id}</strong>
        <span>${adminEscape(match.provincia_1)}${match.provincia_2 ? ` → ${adminEscape(match.provincia_2)}` : ""}</span>
        <span>${(match.comuni || []).map(adminEscape).join(" · ")}</span>
      </span>
      <span class="admin-match__meta">Inserito ${adminDate(match.created_at)}${match.linked_email ? ` · già associato a ${adminEscape(match.linked_email)}` : ""}</span>
    </label>
  `).join("") + `
    <div class="admin-request__actions">
      <button class="primary admin-approve" type="button">Approva e associa</button>
    </div>
  `;
}

async function approveRequest(requestId, article) {
  const selected = article.querySelector(`input[name="candidate-${requestId}"]:checked`);
  if (!selected) {
    window.alert("Seleziona il record corretto.");
    return;
  }

  if (!window.confirm(`Associare la richiesta al record #${selected.value}?`)) return;

  const { data, error } = await adminSupabase.rpc("admin_approve_legacy_claim", {
    p_request_id: requestId,
    p_candidate_id: Number(selected.value)
  });

  if (error) {
    window.alert(error.message);
    return;
  }

  window.alert(data === "linked"
    ? "Richiesta approvata: il record è ora visibile nell’area personale dell’utente."
    : `Richiesta approvata. Codice generato per una richiesta anonima: ${data}`);
  await loadAdminRequests();
}

async function rejectRequest(requestId) {
  const note = window.prompt(
    "Motivo del rifiuto (sarà visibile all’utente):",
    "I dati non consentono di identificare con certezza la compilazione."
  );
  if (note === null) return;

  const { data, error } = await adminSupabase.rpc("admin_reject_legacy_claim", {
    p_request_id: requestId,
    p_admin_note: note
  });

  if (error) {
    window.alert(error.message);
    return;
  }

  if (!data) {
    window.alert("La richiesta non è più in attesa.");
    return;
  }

  await loadAdminRequests();
}

async function adminSignInWithProvider(provider){
  const message=document.querySelector("#admin-social-login-message");
  message.textContent="Reindirizzamento al provider…";

  const redirectTo=new URL("admin.html",window.location.href).href;
  const options={redirectTo};

  if(provider==="azure"){
    options.scopes="openid email profile";
  }

  const {error}=await adminSupabase.auth.signInWithOAuth({provider,options});
  if(error){
    message.textContent=error.message||"Non è stato possibile avviare l’accesso.";
  }
}

document.querySelector("#admin-login-google").addEventListener("click",()=>adminSignInWithProvider("google"));

document.querySelector("#admin-login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const message=document.querySelector("#admin-login-message");
  const email=document.querySelector("#admin-email").value.trim();
  const button=event.submitter;
  message.textContent="Invio del codice…";
  if(button)button.disabled=true;

  try{
    const {error}=await adminSupabase.auth.signInWithOtp({
      email,
      options:{shouldCreateUser:false}
    });
    if(error)throw error;
  }catch(error){
    message.textContent=error?.message||"Non è stato possibile inviare il codice.";
    if(button)button.disabled=false;
    return;
  }

  if(button)button.disabled=false;
  pendingAdminOtpEmail=email;
  message.textContent="Codice inviato. Controlla anche Spam o la webmail.";
  document.querySelector("#admin-login-form").hidden=true;
  document.querySelector("#admin-otp-form").hidden=false;
});

document.querySelector("#admin-otp-form").addEventListener("submit",async event=>{
  event.preventDefault();
  const token=document.querySelector("#admin-otp").value.trim().replace(/\s+/g,"");
  const message=document.querySelector("#admin-otp-message");
  message.textContent="Verifica in corso…";

  const {error}=await adminSupabase.auth.verifyOtp({
    email:pendingAdminOtpEmail,
    token,
    type:"email"
  });

  message.textContent=error?error.message:"Accesso effettuato.";
});

document.querySelector("#admin-change-email").addEventListener("click",()=>{
  pendingAdminOtpEmail="";
  document.querySelector("#admin-otp").value="";
  document.querySelector("#admin-otp-form").hidden=true;
  document.querySelector("#admin-login-form").hidden=false;
});

logoutButton.addEventListener("click", async () => {
  await adminSupabase.auth.signOut();
});

document.querySelector("#admin-refresh").addEventListener("click", loadAdminRequests);
document.querySelector("#admin-status").addEventListener("change", loadAdminRequests);

document.querySelector("#admin-requests").addEventListener("click", async event => {
  const article = event.target.closest(".admin-request");
  if (!article) return;

  const requestId = Number(article.dataset.requestId);

  if (event.target.closest(".admin-find-matches")) {
    await findMatches(requestId, article);
  }

  if (event.target.closest(".admin-create-from-claim")) {
    const request=adminRequests.find(item=>Number(item.id)===requestId);
    openAdminCreateCandidateDialog({
      mode:"claim",
      requestId,
      email:request?.requester_email||"",
      classe:request?.classe||"EEEE",
      posizione:request?.posizione||"",
      punteggio:request?.punteggio||""
    });
  }

  if (event.target.closest(".admin-approve")) {
    await approveRequest(requestId, article);
  }

  if (event.target.closest(".admin-reject")) {
    await rejectRequest(requestId);
  }
});

adminSupabase.auth.onAuthStateChange((_event, session) => {
  handleSession(session);
});

(async function initAdmin() {
  await loadAdminSchools();
  const { data } = await adminSupabase.auth.getSession();
  await handleSession(data.session);
})();






async function loadAdminSchools(){
  if(adminSchools.length)return;
  const response=await fetch("scuole.json",{cache:"no-store"});
  if(!response.ok)throw new Error("Impossibile caricare le scuole.");
  adminSchools=await response.json();
}

function adminSchoolByCode(code){
  return adminSchools.find(s=>s.codice===code);
}

function renderSupportPreferences(preferences){
  const prefs=Array.isArray(preferences)?preferences:[];
  if(!prefs.length)return '<p class="admin-empty">Nessuna scuola selezionata.</p>';

  return `<ol class="admin-support-schools">${prefs.map(pref=>{
    const school=adminSchoolByCode(pref.codice_scuola);
    if(!school)return `<li>${adminEscape(pref.codice_scuola)}</li>`;
    const posts=Number(school.disponibilita?.[pref.classe]||0);
    return `<li>
      <strong>${adminEscape(school.denominazione)} – ${adminEscape(school.comune)}</strong>
      <span>${adminEscape(school.istituto)} · ${adminEscape(school.codice)} · ${posts} posti disponibili</span>
    </li>`;
  }).join("")}</ol>`;
}

function supportLocationData(preferences){
  const schools=(Array.isArray(preferences)?preferences:[])
    .map(pref=>adminSchoolByCode(pref.codice_scuola))
    .filter(Boolean);

  const provinces=[...new Set(schools.map(s=>s.provincia).filter(Boolean))];
  const municipalities=[...new Set(schools.map(s=>s.comune).filter(Boolean))];

  return {
    provincia1:provinces[0]||"Potenza",
    provincia2:provinces[1]||null,
    comuni:municipalities.length?municipalities:["Preferenze scolastiche"]
  };
}

async function loadManualSupportRequests(){
  const root=document.querySelector("#admin-support-requests");
  if(!root)return;

  const status=document.querySelector("#admin-support-status")?.value||"pending";
  root.innerHTML='<p class="admin-empty">Caricamento richieste…</p>';

  const [{data,error},{data:countsData,error:countsError}]=await Promise.all([
    adminSupabase.rpc("admin_list_manual_support_requests",{p_status:status}),
    adminSupabase.rpc("admin_manual_support_counts")
  ]);

  if(countsData&&!countsError){
    const counts=Array.isArray(countsData)?countsData[0]:countsData;
    document.querySelector("#support-pending-count").textContent=counts.pending_count||0;
    document.querySelector("#support-progress-count").textContent=counts.in_progress_count||0;
    document.querySelector("#support-resolved-count").textContent=counts.resolved_count||0;
  }

  if(error){
    root.innerHTML=`<p class="admin-empty">${adminEscape(error.message)}</p>`;
    return;
  }

  const requests=data||[];
  window.__manualSupportRequests=requests;
  root.innerHTML=requests.length?requests.map(request=>`
    <article class="admin-request" data-support-id="${request.id}">
      <header class="admin-request__head">
        <div>
          <h2>${adminEscape(request.email)}</h2>
          <p>Ricevuta ${adminDate(request.created_at)}</p>
        </div>
        <span class="admin-request__status">${statusLabel(request.status)}</span>
      </header>
      <div class="admin-request__body">
        <div class="admin-request__facts">
          <div class="admin-fact"><span>Contatto</span><strong>${adminEscape(request.contact_email||request.email)}</strong></div>
          <div class="admin-fact"><span>Classe</span><strong>${adminEscape(request.classe)}</strong></div>
          <div class="admin-fact"><span>Posizione</span><strong>${request.posizione}</strong></div>
          <div class="admin-fact"><span>Punteggio</span><strong>${Number(request.punteggio).toLocaleString("it-IT",{minimumFractionDigits:2})}</strong></div>
          <div class="admin-fact"><span>Problema</span><strong>${adminEscape(request.issue)}</strong></div>
          <div class="admin-fact"><span>Record coincidenti</span><strong>${request.existing_matches||0}</strong></div>
        </div>
        ${request.note?`<p class="admin-note"><strong>Nota utente:</strong> ${adminEscape(request.note)}</p>`:""}
        ${request.admin_note?`<p class="admin-note"><strong>Nota amministratore:</strong> ${adminEscape(request.admin_note)}</p>`:""}
        ${request.candidate_id?`<p class="admin-note"><strong>Compilazione collegata:</strong> record #${request.candidate_id}</p>`:""}
        <div class="support-preferences-block">
          <h3>Scuole selezionate dall’utente</h3>
          ${renderSupportPreferences(request.preferenze_scuole)}
        </div>
        <div class="support-candidate-tools">
          <details>
            <summary>Gestisci la compilazione</summary>
            <div class="support-candidate-tools__body">
              <p>Puoi cercare un record esistente oppure creare la compilazione usando esattamente le scuole selezionate nella segnalazione.</p>
              <label class="support-create-grid__wide">Email account da associare
                <input class="support-link-email" type="email" value="${adminEscape(request.email)}">
                <small>Facoltativa: deve già esistere in Supabase Auth.</small>
              </label>
              <div class="admin-request__actions">
                <button class="secondary support-find-candidates" type="button">Cerca record coincidenti</button>
                <button class="primary support-create-candidate" type="button">Crea compilazione con queste scuole</button>
              </div>
              <div class="support-candidate-results" hidden></div>
            </div>
          </details>
        </div>
        <div class="admin-request__actions">
          ${request.status==="pending"?'<button class="secondary support-take" type="button">Prendi in carico</button>':""}
          ${request.status!=="resolved"?'<button class="primary support-resolve" type="button">Segna come risolta</button>':""}
          ${request.status!=="dismissed"?'<button class="danger-button support-dismiss" type="button">Archivia</button>':""}
        </div>
      </div>
    </article>
  `).join(""):'<p class="admin-empty">Nessuna richiesta per questo filtro.</p>';
}

document.querySelector("#admin-support-status")?.addEventListener("change",loadManualSupportRequests);

document.querySelector("#admin-support-requests")?.addEventListener("click",async event=>{
  const article=event.target.closest(".admin-request");
  if(!article)return;

  const requestId=Number(article.dataset.supportId);

  if(event.target.closest(".support-find-candidates")){
    const root=article.querySelector(".support-candidate-results");
    root.hidden=false;
    root.innerHTML='<p class="admin-empty">Ricerca in corso…</p>';

    const {data,error}=await adminSupabase.rpc("admin_find_manual_support_candidates",{
      p_request_id:requestId
    });

    if(error){
      root.innerHTML=`<p class="admin-empty">${adminEscape(error.message)}</p>`;
      return;
    }

    const matches=data||[];
    root.innerHTML=matches.length?matches.map(match=>`
      <div class="support-candidate-match" data-candidate-id="${match.candidate_id}">
        <div>
          <strong>Record #${match.candidate_id}</strong>
          <span>${adminEscape(match.email||"Non associato")} · ${adminEscape((match.comuni||[]).join(", "))}</span>
        </div>
        <button class="secondary support-use-candidate" type="button">Collega alla segnalazione</button>
      </div>
    `).join(""):'<p class="admin-empty">Nessun record coincidente.</p>';
    return;
  }

  if(event.target.closest(".support-use-candidate")){
    const match=event.target.closest(".support-candidate-match");
    const candidateId=Number(match.dataset.candidateId);
    const email=article.querySelector(".support-link-email")?.value.trim()||null;

    if(!confirm(`Collegare la segnalazione al record #${candidateId}?`))return;

    const {error}=await adminSupabase.rpc("admin_attach_manual_support_candidate",{
      p_request_id:requestId,
      p_candidate_id:candidateId,
      p_account_email:email
    });

    if(error)return alert(error.message);
    await Promise.all([loadManualSupportRequests(),loadAdminRecords(),loadDuplicates()]);
    return;
  }

  if(event.target.closest(".support-create-candidate")){
    const email=article.querySelector(".support-link-email").value.trim()||null;
    const request=(window.__manualSupportRequests||[]).find(item=>Number(item.id)===requestId);

    if(!request||!Array.isArray(request.preferenze_scuole)||!request.preferenze_scuole.length){
      alert("La segnalazione non contiene preferenze scolastiche.");
      return;
    }

    const location=supportLocationData(request.preferenze_scuole);

    if(!confirm("Creare una nuova compilazione con le scuole selezionate dall’utente?"))return;

    const {data,error}=await adminSupabase.rpc("admin_create_candidate_from_manual_support",{
      p_request_id:requestId,
      p_preferenze_scuole:request.preferenze_scuole,
      p_provincia_1:location.provincia1,
      p_provincia_2:location.provincia2,
      p_comuni:location.comuni,
      p_account_email:email
    });

    if(error)return alert(error.message);
    alert(`Compilazione creata: record #${data}`);
    await Promise.all([loadManualSupportRequests(),loadAdminRecords(),loadDuplicates()]);
    return;
  }

  let status=null;
  let note=null;

  if(event.target.closest(".support-take")){
    status="in_progress";
    note=prompt("Nota interna o istruzioni per il ricontatto:","Richiesta presa in carico.");
    if(note===null)return;
  }

  if(event.target.closest(".support-resolve")){
    status="resolved";
    note=prompt("Come è stata risolta la richiesta?","Utente ricontattato e accesso ripristinato.");
    if(note===null)return;
  }

  if(event.target.closest(".support-dismiss")){
    if(!confirm("Archiviare questa richiesta?"))return;
    status="dismissed";
    note="Richiesta archiviata.";
  }

  if(!status)return;

  const {error}=await adminSupabase.rpc("admin_update_manual_support_request",{
    p_request_id:requestId,
    p_status:status,
    p_admin_note:note
  });

  if(error)return alert(error.message);
  await loadManualSupportRequests();
});

async function loadRegistrationRequests(){
  const status=document.querySelector("#admin-registration-status")?.value||"pending";
  const root=document.querySelector("#admin-registration-requests");
  if(!root)return;

  root.innerHTML='<p class="admin-empty">Caricamento richieste…</p>';

  const [{data,error},{data:countsData,error:countsError}]=await Promise.all([
    adminSupabase.rpc("admin_list_registration_requests",{p_status:status}),
    adminSupabase.rpc("admin_registration_counts")
  ]);

  if(countsData&&!countsError){
    const counts=Array.isArray(countsData)?countsData[0]:countsData;
    document.querySelector("#registration-pending-count").textContent=counts.pending_count||0;
    document.querySelector("#registration-approved-count").textContent=counts.approved_count||0;
    document.querySelector("#registration-rejected-count").textContent=counts.rejected_count||0;
  }

  if(error){
    root.innerHTML=`<p class="admin-empty">${adminEscape(error.message)}</p>`;
    return;
  }

  const requests=data||[];
  root.innerHTML=requests.length?requests.map(request=>`
    <article class="admin-request" data-registration-id="${request.id}" data-status="${request.status}">
      <header class="admin-request__head">
        <div>
          <h2>${adminEscape(request.email)}</h2>
          <p>Ricevuta ${adminDate(request.created_at)}</p>
        </div>
        <span class="admin-request__status">${statusLabel(request.status)}</span>
      </header>
      <div class="admin-request__body">
        <div class="admin-request__facts">
          <div class="admin-fact"><span>Classe</span><strong>${adminEscape(request.classe)}</strong></div>
          <div class="admin-fact"><span>Posizione</span><strong>${request.posizione}</strong></div>
          <div class="admin-fact"><span>Punteggio</span><strong>${Number(request.punteggio).toLocaleString("it-IT",{minimumFractionDigits:2})}</strong></div>
          <div class="admin-fact"><span>Record coincidenti</span><strong>${request.existing_matches||0}</strong></div>
        </div>
        ${request.admin_note?`<p class="admin-note">${adminEscape(request.admin_note)}</p>`:""}
        ${request.status==="pending"?`
          <div class="admin-request__actions">
            <button class="primary admin-approve-registration" type="button">Approva iscrizione</button>
            <button class="danger-button admin-reject-registration" type="button">Rifiuta</button>
          </div>`:`<p class="admin-note">Esaminata ${adminDate(request.reviewed_at)}</p>`}
      </div>
    </article>`).join(""):'<p class="admin-empty">Nessuna richiesta per questo filtro.</p>';
}

document.querySelector("#admin-registration-status")?.addEventListener("change",loadRegistrationRequests);

document.querySelector("#admin-registration-requests")?.addEventListener("click",async event=>{
  const article=event.target.closest(".admin-request");
  if(!article)return;
  const requestId=Number(article.dataset.registrationId);

  if(event.target.closest(".admin-approve-registration")){
    if(!confirm("Approvare questa nuova iscrizione?"))return;
    const {error}=await adminSupabase.rpc("admin_approve_registration_request",{p_request_id:requestId});
    if(error)return alert(error.message);
    await loadRegistrationRequests();
  }

  if(event.target.closest(".admin-reject-registration")){
    const note=prompt("Motivo del rifiuto:","Dati non verificabili o già presenti.");
    if(note===null)return;
    const {error}=await adminSupabase.rpc("admin_reject_registration_request",{
      p_request_id:requestId,
      p_admin_note:note
    });
    if(error)return alert(error.message);
    await loadRegistrationRequests();
  }
});


function renderAdminCreateSchoolSearch(){
  const root=document.querySelector("#admin-create-school-results");
  if(!root)return;

  const classe=document.querySelector("#admin-create-class").value;
  const province=document.querySelector("#admin-create-school-province").value;
  const query=document.querySelector("#admin-create-school-search").value.trim().toLocaleLowerCase("it-IT");

  const matches=adminSchools.filter(school=>{
    const hay=`${school.denominazione} ${school.comune} ${school.istituto} ${school.codice}`.toLocaleLowerCase("it-IT");
    return adminAvailablePosts(school,classe)>0
      && (!province||school.provincia===province)
      && (!query||hay.includes(query))
      && !creatingAdminPreferences.some(pref=>pref.codice_scuola===school.codice);
  }).slice(0,60);

  root.innerHTML=matches.length?matches.map(school=>`
    <article class="school-result">
      <div>
        <strong>${adminEscape(school.denominazione)} – ${adminEscape(school.comune)}</strong>
        <span>${adminEscape(school.istituto)}</span>
        <small>${adminEscape(school.codice)}</small>
        <span class="school-result__posts">${adminAvailablePosts(school,classe)} posti disponibili</span>
      </div>
      <button class="secondary admin-create-add-school" type="button" data-code="${school.codice}">Aggiungi</button>
    </article>`).join(""):'<p class="admin-empty">Nessuna scuola disponibile per questi criteri.</p>';
}

function renderAdminCreateSelectedSchools(){
  const root=document.querySelector("#admin-create-selected-schools");
  const counter=document.querySelector("#admin-create-school-counter");
  if(!root||!counter)return;

  counter.textContent=`${creatingAdminPreferences.length} / 30`;
  root.innerHTML=creatingAdminPreferences.length?creatingAdminPreferences.map((pref,index)=>{
    const school=adminSchoolByCode(pref.codice_scuola);
    return `<article class="selected-school">
      <span class="selected-school__number">${index+1}</span>
      <div>
        <strong>${adminEscape(school?.denominazione||pref.codice_scuola)}${school?` – ${adminEscape(school.comune)}`:""}</strong>
        <span>${school?`${adminEscape(school.istituto)} · ${adminAvailablePosts(school,pref.classe)} posti disponibili`:""}</span>
      </div>
      <div class="selected-school__actions">
        <button class="secondary admin-create-move-school" data-index="${index}" data-dir="-1" type="button">↑</button>
        <button class="secondary admin-create-move-school" data-index="${index}" data-dir="1" type="button">↓</button>
        <button class="danger-button admin-create-remove-school" data-index="${index}" type="button">×</button>
      </div>
    </article>`;
  }).join(""):'<p class="admin-empty">Seleziona almeno una scuola.</p>';

  renderAdminCreateSchoolSearch();
}

function openAdminCreateCandidateDialog(options={}){
  document.querySelector("#admin-create-mode").value=options.mode||"preregister";
  document.querySelector("#admin-create-request-id").value=options.requestId||"";
  document.querySelector("#admin-create-email").value=options.email||"";
  document.querySelector("#admin-create-class").value=options.classe||"EEEE";
  document.querySelector("#admin-create-position").value=options.posizione||"";
  document.querySelector("#admin-create-score").value=options.punteggio||"";
  document.querySelector("#admin-create-candidate-title").textContent=
    options.mode==="claim"?"Crea compilazione dalla richiesta":"Crea utente pre-registrato";
  document.querySelector("#admin-create-candidate-message").textContent="";
  document.querySelector("#admin-create-school-search").value="";
  document.querySelector("#admin-create-school-province").value="";
  creatingAdminPreferences=[];
  renderAdminCreateSelectedSchools();
  document.querySelector("#admin-create-candidate-dialog").showModal();
}

function closeAdminCreateCandidateDialog(){
  document.querySelector("#admin-create-candidate-dialog")?.close();
  creatingAdminPreferences=[];
}

async function loadPreregisteredUsers(){
  const root=document.querySelector("#admin-preregistered-users");
  if(!root)return;
  root.innerHTML='<p class="admin-empty">Caricamento utenti…</p>';

  const {data,error}=await adminSupabase.rpc("admin_list_preregistered_users");
  if(error){
    root.innerHTML=`<p class="admin-empty">${adminEscape(error.message)}</p>`;
    return;
  }

  preregisteredUsersCache=data||[];
  const waiting=preregisteredUsersCache.filter(item=>item.status==="waiting").length;
  const activated=preregisteredUsersCache.filter(item=>item.status==="activated").length;
  document.querySelector("#preregistered-waiting-count").textContent=waiting;
  document.querySelector("#preregistered-activated-count").textContent=activated;

  root.innerHTML=preregisteredUsersCache.length?preregisteredUsersCache.map(item=>`
    <article class="admin-user-row" data-preregistered-id="${item.id}">
      <div>
        <strong>${adminEscape(item.email)}</strong>
        <small>Record #${item.candidate_id} · ${item.status==="activated"?"Account attivato":"In attesa del primo accesso"}</small>
        <small>Creato ${adminDate(item.created_at)}${item.activated_at?` · attivato ${adminDate(item.activated_at)}`:""}</small>
      </div>
      <div class="admin-record-row__actions">
        <button class="secondary admin-copy-preregistered-message" type="button">Copia messaggio</button>
        ${item.status==="waiting"?'<button class="danger-button admin-delete-preregistered" type="button">Elimina predisposizione</button>':""}
      </div>
    </article>`).join(""):'<p class="admin-empty">Nessun utente pre-registrato.</p>';
}

async function loadAdminUsers(){
  const root=document.querySelector("#admin-users-list");
  if(!root)return;
  root.innerHTML='<p class="admin-empty">Caricamento amministratori…</p>';
  const {data,error}=await adminSupabase.rpc("admin_list_users");
  if(error){root.innerHTML=`<p class="admin-empty">${adminEscape(error.message)}</p>`;return}
  root.innerHTML=(data||[]).map(user=>`
    <article class="admin-user-row">
      <div><strong>${adminEscape(user.email)}</strong><small>Aggiunto ${adminDate(user.created_at)}</small></div>
      ${user.is_current
        ? '<span class="badge">Account attuale</span>'
        : `<button class="danger-button admin-remove-user" type="button" data-user-id="${user.user_id}">Rimuovi</button>`}
    </article>`).join("");
}

function getRecordFilters(){
  const idValue=document.querySelector("#admin-filter-id")?.value.trim()||"";
  const positionValue=document.querySelector("#admin-filter-position")?.value.trim()||"";
  const scoreValue=document.querySelector("#admin-filter-score")?.value.trim()||"";

  return {
    p_candidate_id:idValue?Number(idValue):null,
    p_email:(document.querySelector("#admin-filter-email")?.value||"").trim()||null,
    p_classe:document.querySelector("#admin-filter-class")?.value||null,
    p_posizione:positionValue?Number(positionValue):null,
    p_punteggio:scoreValue?Number(scoreValue):null,
    p_comune:(document.querySelector("#admin-filter-municipality")?.value||"").trim()||null,
    p_linked_status:document.querySelector("#admin-filter-linked")?.value||"all",
    p_preferences_status:document.querySelector("#admin-filter-preferences")?.value||"all"
  };
}

function renderCandidatureSummary(candidature){
  return (candidature||[]).map(item=>
    `${adminEscape(item.classe)} · posizione ${adminEscape(item.posizione)} · ${adminEscape(item.punteggio)} punti`
  ).join("<br>");
}


function adminAvailablePosts(school,classe){
  return Number(school?.disponibilita?.[classe]||0);
}

function adminAddEditCandidature(value={}){
  const root=document.querySelector("#admin-edit-candidatures");
  if(!root||root.children.length>=4)return;

  const row=document.createElement("div");
  row.className="admin-edit-candidature";
  row.innerHTML=`
    <label>Classe
      <select class="admin-edit-class">
        <option value="AAAA">AAAA</option>
        <option value="ADAA">ADAA</option>
        <option value="EEEE">EEEE</option>
        <option value="ADEE">ADEE</option>
      </select>
    </label>
    <label>Posizione
      <input class="admin-edit-position" type="number" min="1" step="1" required>
    </label>
    <label>Punteggio
      <input class="admin-edit-score" type="number" min="0" step="0.01" required>
    </label>
    <button class="danger-button admin-remove-edit-candidature" type="button">Rimuovi</button>`;

  row.querySelector(".admin-edit-class").value=value.classe||"EEEE";
  row.querySelector(".admin-edit-position").value=value.posizione??"";
  row.querySelector(".admin-edit-score").value=value.punteggio??"";
  root.appendChild(row);
  refreshAdminEditSchoolClasses();
}

function getAdminEditedCandidatures(){
  return [...document.querySelectorAll(".admin-edit-candidature")].map(row=>({
    classe:row.querySelector(".admin-edit-class").value,
    posizione:Number(row.querySelector(".admin-edit-position").value),
    punteggio:Number(row.querySelector(".admin-edit-score").value)
  }));
}

function refreshAdminEditSchoolClasses(){
  const select=document.querySelector("#admin-edit-school-class");
  if(!select)return;
  const current=select.value;
  const classes=[...new Set(
    [...document.querySelectorAll(".admin-edit-class")].map(node=>node.value)
  )];

  select.innerHTML=classes.map(classe=>`<option value="${classe}">${classe}</option>`).join("");
  if(classes.includes(current))select.value=current;
  renderAdminEditSchoolSearch();
}

function renderAdminEditSchoolSearch(){
  const root=document.querySelector("#admin-edit-school-results");
  if(!root)return;

  const classe=document.querySelector("#admin-edit-school-class")?.value;
  const province=document.querySelector("#admin-edit-school-province")?.value||"";
  const query=(document.querySelector("#admin-edit-school-search")?.value||"").trim().toLocaleLowerCase("it-IT");

  if(!classe){
    root.innerHTML='<p class="admin-empty">Aggiungi prima una candidatura.</p>';
    return;
  }

  const matches=adminSchools.filter(school=>{
    const hay=`${school.denominazione} ${school.comune} ${school.istituto} ${school.codice}`.toLocaleLowerCase("it-IT");
    return adminAvailablePosts(school,classe)>0
      && (!province||school.provincia===province)
      && (!query||hay.includes(query))
      && !editingAdminPreferences.some(pref=>pref.classe===classe&&pref.codice_scuola===school.codice);
  }).slice(0,60);

  root.innerHTML=matches.length?matches.map(school=>`
    <article class="school-result">
      <div>
        <strong>${adminEscape(school.denominazione)} – ${adminEscape(school.comune)}</strong>
        <span>${adminEscape(school.istituto)}</span>
        <small>${adminEscape(school.codice)}</small>
        <span class="school-result__posts">${adminAvailablePosts(school,classe)} posti disponibili</span>
      </div>
      <button class="secondary admin-add-edit-school" type="button" data-code="${school.codice}" data-class="${classe}">Aggiungi</button>
    </article>`).join(""):'<p class="admin-empty">Nessuna scuola disponibile per questi criteri.</p>';
}

function renderAdminEditSelectedSchools(){
  const root=document.querySelector("#admin-edit-selected-schools");
  const counter=document.querySelector("#admin-edit-school-counter");
  if(!root||!counter)return;

  counter.textContent=`${editingAdminPreferences.length} / 30`;

  root.innerHTML=editingAdminPreferences.length?editingAdminPreferences.map((pref,index)=>{
    const school=adminSchoolByCode(pref.codice_scuola);
    return `<article class="selected-school">
      <span class="selected-school__number">${index+1}</span>
      <div>
        <strong><span class="class-chip ${adminEscape(pref.classe)}">${adminEscape(pref.classe)}</span> ${adminEscape(school?.denominazione||pref.codice_scuola)}${school?` – ${adminEscape(school.comune)}`:""}</strong>
        <span>${school?`${adminEscape(school.istituto)} · ${adminAvailablePosts(school,pref.classe)} posti disponibili`:"Scuola non presente nel file corrente"}</span>
      </div>
      <div class="selected-school__actions">
        <button class="secondary admin-move-edit-school" data-index="${index}" data-dir="-1" type="button">↑</button>
        <button class="secondary admin-move-edit-school" data-index="${index}" data-dir="1" type="button">↓</button>
        <button class="danger-button admin-remove-edit-school" data-index="${index}" type="button">×</button>
      </div>
    </article>`;
  }).join(""):'<p class="admin-empty">Nessuna preferenza scolastica.</p>';

  renderAdminEditSchoolSearch();
}

async function openAdminRecordEditor(candidateId){
  const dialog=document.querySelector("#admin-record-editor");
  const message=document.querySelector("#admin-record-editor-message");
  message.textContent="Caricamento record…";

  const {data,error}=await adminSupabase.rpc("admin_get_candidate_record",{
    p_candidate_id:candidateId
  });

  if(error){
    alert(error.message);
    return;
  }

  editingAdminRecord=Array.isArray(data)?data[0]:data;
  if(!editingAdminRecord){
    alert("Record non trovato.");
    return;
  }

  document.querySelector("#admin-record-editor-title").textContent=`Modifica record #${candidateId}`;
  document.querySelector("#admin-edit-record-email").value=editingAdminRecord.email||"";
  document.querySelector("#admin-edit-candidatures").innerHTML="";
  (editingAdminRecord.candidature||[]).forEach(adminAddEditCandidature);
  if(!document.querySelector("#admin-edit-candidatures").children.length)adminAddEditCandidature();

  editingAdminPreferences=(editingAdminRecord.preferenze_scuole||[]).map(pref=>({
    classe:pref.classe,
    codice_scuola:pref.codice_scuola
  }));

  renderAdminEditSelectedSchools();
  message.textContent="";
  dialog.showModal();
}

function closeAdminRecordEditor(){
  document.querySelector("#admin-record-editor")?.close();
  editingAdminRecord=null;
  editingAdminPreferences=[];
}

function deriveAdminLocations(preferences){
  const schools=preferences.map(pref=>adminSchoolByCode(pref.codice_scuola)).filter(Boolean);
  const provinces=[...new Set(schools.map(school=>school.provincia).filter(Boolean))];
  const municipalities=[...new Set(schools.map(school=>school.comune).filter(Boolean))];
  return {
    provincia1:provinces[0]||editingAdminRecord?.provincia_1||"Potenza",
    provincia2:provinces[1]||null,
    comuni:municipalities.length?municipalities:(editingAdminRecord?.comuni||["Preferenze scolastiche"])
  };
}

function updateRecordSelectionUi(){
  const count=selectedAdminRecordIds.size;
  const countRoot=document.querySelector("#admin-selected-record-count");
  const deleteButton=document.querySelector("#admin-delete-selected-records");
  const selectAll=document.querySelector("#admin-select-all-records");

  if(countRoot)countRoot.textContent=`${count} ${count===1?"selezionato":"selezionati"}`;
  if(deleteButton)deleteButton.disabled=count===0;
  if(selectAll){
    const visibleIds=adminRecordsCache.map(record=>Number(record.candidate_id));
    selectAll.checked=visibleIds.length>0&&visibleIds.every(id=>selectedAdminRecordIds.has(id));
    selectAll.indeterminate=visibleIds.some(id=>selectedAdminRecordIds.has(id))&&!selectAll.checked;
  }
}

async function loadAdminRecords(){
  const root=document.querySelector("#admin-records");
  const countRoot=document.querySelector("#admin-record-results-count");
  if(!root)return;

  root.innerHTML='<p class="admin-empty">Caricamento record…</p>';
  countRoot.textContent="";

  const {data,error}=await adminSupabase.rpc("admin_search_candidates_advanced",getRecordFilters());
  if(error){
    root.innerHTML=`<p class="admin-empty">${adminEscape(error.message)}</p>`;
    return;
  }

  adminRecordsCache=data||[];
  const visibleIds=new Set(adminRecordsCache.map(record=>Number(record.candidate_id)));
  [...selectedAdminRecordIds].forEach(id=>{if(!visibleIds.has(id))selectedAdminRecordIds.delete(id)});

  countRoot.textContent=`${adminRecordsCache.length} ${adminRecordsCache.length===1?"record trovato":"record trovati"}`;

  root.innerHTML=adminRecordsCache.length?adminRecordsCache.map(record=>`
    <article class="admin-record-row" data-candidate-id="${record.candidate_id}">
      <label class="admin-record-row__select" title="Seleziona il record">
        <input class="admin-record-checkbox" type="checkbox" ${selectedAdminRecordIds.has(Number(record.candidate_id))?"checked":""}>
        <span class="sr-only">Seleziona record #${record.candidate_id}</span>
      </label>
      <div class="admin-record-row__main">
        <div class="admin-record-row__title">
          <strong>Record #${record.candidate_id}</strong>
          <span class="badge ${record.email?"badge--linked":"badge--unlinked"}">
            ${record.email?"Account associato":"Account non associato"}
          </span>
          <span class="badge ${Number(record.preferences_count)>0?"badge--complete":"badge--historic"}">
            ${Number(record.preferences_count)>0
              ?"Pubblicato – preferenze scolastiche complete"
              :"Pubblicato – dati storici per comune"}
          </span>
        </div>
        <span>${record.email?adminEscape(record.email):"Nessun account collegato"}</span>
        <div class="admin-record-candidatures">${renderCandidatureSummary(record.candidature)}</div>
        <small>Comuni storici: ${(record.comuni||[]).length?(record.comuni||[]).map(adminEscape).join(" · "):"—"}</small>
        <small>${record.preferences_count} preferenze scolastiche · aggiornato ${adminDate(record.updated_at||record.created_at)}</small>
      </div>
      <div class="admin-record-row__actions">
        <button class="secondary admin-edit-record" type="button">Modifica</button>
        ${record.email?"":'<button class="secondary admin-link-record" type="button">Associa a email</button>'}
        <button class="danger-button admin-delete-record" type="button">Elimina</button>
      </div>
    </article>`).join(""):'<p class="admin-empty">Nessun record corrisponde ai filtri selezionati.</p>';

  updateRecordSelectionUi();
}

async function loadDuplicates(){
  const root=document.querySelector("#admin-duplicates");
  const countRoot=document.querySelector("#admin-duplicate-count");
  if(!root)return;

  root.innerHTML='<p class="admin-empty">Ricerca dei duplicati…</p>';

  const {data,error}=await adminSupabase.rpc("admin_find_possible_duplicates_detailed");
  if(error){
    console.error("Errore caricamento duplicati:", error);
    root.innerHTML=`<p class="admin-empty"><strong>Impossibile caricare i duplicati.</strong><br>${adminEscape(error.message)}</p>`;
    countRoot.textContent="Errore";
    return;
  }

  const groups=data||[];
  countRoot.textContent=`${groups.length} ${groups.length===1?"gruppo":"gruppi"}`;

  root.innerHTML=groups.length?groups.map((group,index)=>{
    const records=group.records||[];
    const linkedRecords=records.filter(record=>record.email);
    const suggestedPrimary=(linkedRecords[0]||records[0])?.candidate_id;

    return `
    <article class="admin-duplicate-group" data-group-index="${index}">
      <header>
        <div>
          <strong>Gruppo ${index+1}</strong>
          <span>${adminEscape(group.signature)}</span>
        </div>
        <span class="badge">${group.record_count} record</span>
      </header>
      <div class="admin-duplicate-records">
        ${records.map(record=>`
          <div class="admin-duplicate-record" data-candidate-id="${record.candidate_id}">
            <label class="admin-duplicate-primary">
              <input
                class="admin-duplicate-primary-radio"
                type="radio"
                name="duplicate-primary-${index}"
                value="${record.candidate_id}"
                ${Number(record.candidate_id)===Number(suggestedPrimary)?"checked":""}
              >
              <span>Conserva questo</span>
            </label>
            <div>
              <strong>Record #${record.candidate_id}</strong>
              <span>${record.email?adminEscape(record.email):"Non associato a un account"}</span>
              <span class="badge ${Number(record.preferences_count)>0?"badge--complete":"badge--historic"}">
                ${Number(record.preferences_count)>0
                  ?"Preferenze scolastiche complete"
                  :"Dati storici per comune"}
              </span>
              <small>${(record.comuni||[]).map(adminEscape).join(" · ")||"Nessun comune storico"}</small>
              <small>${record.preferences_count||0} preferenze scolastiche · ${adminDate(record.updated_at||record.created_at)}</small>
            </div>
            <div class="admin-record-row__actions">
              <button class="secondary admin-edit-duplicate" type="button">Modifica</button>
              ${record.email?"":'<button class="secondary admin-link-duplicate" type="button">Associa</button>'}
              <button class="danger-button admin-delete-duplicate" type="button">Elimina</button>
            </div>
          </div>`).join("")}
      </div>
      <footer class="admin-duplicate-merge">
        <div>
          <strong>Unisci il gruppo</strong>
          <p>Il record selezionato sarà conservato; account e preferenze compatibili verranno trasferiti dagli altri.</p>
        </div>
        <button class="primary admin-merge-duplicates" type="button">Unisci duplicati</button>
      </footer>
    </article>`;
  }).join(""):'<p class="admin-empty">Nessun duplicato esatto rilevato.</p>';
}


document.querySelector("#admin-new-preregistered-user")?.addEventListener("click",()=>{
  openAdminCreateCandidateDialog({mode:"preregister"});
});

["admin-close-create-candidate","admin-cancel-create-candidate"].forEach(id=>{
  document.querySelector(`#${id}`)?.addEventListener("click",closeAdminCreateCandidateDialog);
});

document.querySelector("#admin-create-class")?.addEventListener("change",()=>{
  creatingAdminPreferences=[];
  renderAdminCreateSelectedSchools();
});
document.querySelector("#admin-create-school-province")?.addEventListener("change",renderAdminCreateSchoolSearch);
document.querySelector("#admin-create-school-search")?.addEventListener("input",renderAdminCreateSchoolSearch);

document.querySelector("#admin-create-school-results")?.addEventListener("click",event=>{
  const button=event.target.closest(".admin-create-add-school");
  if(!button||creatingAdminPreferences.length>=30)return;
  creatingAdminPreferences.push({
    classe:document.querySelector("#admin-create-class").value,
    codice_scuola:button.dataset.code
  });
  renderAdminCreateSelectedSchools();
});

document.querySelector("#admin-create-selected-schools")?.addEventListener("click",event=>{
  const remove=event.target.closest(".admin-create-remove-school");
  if(remove){
    creatingAdminPreferences.splice(Number(remove.dataset.index),1);
    renderAdminCreateSelectedSchools();
    return;
  }

  const move=event.target.closest(".admin-create-move-school");
  if(move){
    const index=Number(move.dataset.index);
    const target=index+Number(move.dataset.dir);
    if(target>=0&&target<creatingAdminPreferences.length){
      [creatingAdminPreferences[index],creatingAdminPreferences[target]]=[
        creatingAdminPreferences[target],creatingAdminPreferences[index]
      ];
      renderAdminCreateSelectedSchools();
    }
  }
});

document.querySelector("#admin-create-candidate-form")?.addEventListener("submit",async event=>{
  event.preventDefault();
  const message=document.querySelector("#admin-create-candidate-message");
  const button=event.submitter;
  const mode=document.querySelector("#admin-create-mode").value;
  const email=document.querySelector("#admin-create-email").value.trim();
  const classe=document.querySelector("#admin-create-class").value;
  const posizione=Number(document.querySelector("#admin-create-position").value);
  const punteggio=Number(document.querySelector("#admin-create-score").value);

  if(!email||!Number.isInteger(posizione)||posizione<1||!Number.isFinite(punteggio)||punteggio<0){
    message.textContent="Controlla email, posizione e punteggio.";
    return;
  }

  if(!creatingAdminPreferences.length){
    message.textContent="Seleziona almeno una scuola.";
    return;
  }

  const preferences=creatingAdminPreferences.map((pref,index)=>({
    classe:pref.classe,
    codice_scuola:pref.codice_scuola,
    ordine:index+1
  }));
  const locations=supportLocationData(preferences);

  message.textContent="Creazione in corso…";
  if(button)button.disabled=true;

  const rpc=mode==="claim"
    ?"admin_create_candidate_from_claim"
    :"admin_create_preregistered_candidate";

  const args={
    p_email:email,
    p_classe:classe,
    p_posizione:posizione,
    p_punteggio:punteggio,
    p_preferenze_scuole:preferences,
    p_provincia_1:locations.provincia1,
    p_provincia_2:locations.provincia2,
    p_comuni:locations.comuni
  };

  if(mode==="claim"){
    args.p_request_id=Number(document.querySelector("#admin-create-request-id").value);
  }

  const {data,error}=await adminSupabase.rpc(rpc,args);
  if(button)button.disabled=false;

  if(error){
    message.textContent=error.message;
    return;
  }

  closeAdminCreateCandidateDialog();
  alert(mode==="claim"
    ?`Compilazione creata e richiesta approvata. Record #${data}.`
    :`Utente predisposto correttamente. Record #${data}.`);

  await Promise.all([
    loadAdminRequests(),
    loadPreregisteredUsers(),
    loadAdminRecords(),
    loadDuplicates()
  ]);
});

document.querySelector("#admin-preregistered-users")?.addEventListener("click",async event=>{
  const row=event.target.closest(".admin-user-row");
  if(!row)return;
  const item=preregisteredUsersCache.find(entry=>Number(entry.id)===Number(row.dataset.preregisteredId));
  if(!item)return;

  if(event.target.closest(".admin-copy-preregistered-message")){
    const text=`Ciao! Ho predisposto la tua compilazione sul sito PNRR3 Basilicata. Puoi accedere da https://pnrr3.carlomagni.it/account.html usando Google oppure il codice email, purché utilizzi l’indirizzo ${item.email}. Al primo accesso la compilazione sarà associata automaticamente al tuo account.`;
    try{
      await navigator.clipboard.writeText(text);
      alert("Messaggio copiato.");
    }catch{
      prompt("Copia il messaggio:",text);
    }
  }

  if(event.target.closest(".admin-delete-preregistered")){
    if(!confirm(`Eliminare la predisposizione per ${item.email} e il relativo record #${item.candidate_id}?`))return;
    const {error}=await adminSupabase.rpc("admin_delete_preregistered_user",{p_id:Number(item.id)});
    if(error)return alert(error.message);
    await Promise.all([loadPreregisteredUsers(),loadAdminRecords(),loadDuplicates()]);
  }
});

document.querySelector("#admin-add-user-form")?.addEventListener("submit",async event=>{
  event.preventDefault();
  const email=document.querySelector("#admin-new-user-email").value.trim();
  const message=document.querySelector("#admin-users-message");
  message.textContent="Aggiunta in corso…";
  const {error}=await adminSupabase.rpc("admin_add_user_by_email",{p_email:email});
  message.textContent=error?error.message:"Amministratore aggiunto.";
  if(!error){event.target.reset();await loadAdminUsers()}
});

document.querySelector("#admin-users-list")?.addEventListener("click",async event=>{
  const button=event.target.closest(".admin-remove-user");
  if(!button)return;
  if(!confirm("Rimuovere questo amministratore?"))return;
  const {error}=await adminSupabase.rpc("admin_remove_user",{p_user_id:button.dataset.userId});
  if(error)return alert(error.message);
  await loadAdminUsers();
});

document.querySelector("#admin-record-search-form")?.addEventListener("submit",event=>{
  event.preventDefault();
  loadAdminRecords();
});

document.querySelector("#admin-reset-record-filters")?.addEventListener("click",()=>{
  document.querySelector("#admin-record-search-form").reset();
  loadAdminRecords();
});

document.querySelector("#admin-refresh-records")?.addEventListener("click",()=>{
  Promise.all([loadAdminRecords(),loadDuplicates()]);
});


document.querySelector("#admin-records")?.addEventListener("click",async event=>{
  const row=event.target.closest(".admin-record-row");
  if(!row)return;
  const candidateId=Number(row.dataset.candidateId);

  if(event.target.closest(".admin-edit-record")){
    await openAdminRecordEditor(candidateId);
    return;
  }

  if(event.target.closest(".admin-delete-record")){
    if(!confirm(`Eliminare definitivamente il record #${candidateId}?`))return;
    const {error}=await adminSupabase.rpc("admin_delete_candidate",{p_candidate_id:candidateId});
    if(error)return alert(error.message);
    await loadAdminRecords();
  }

  if(event.target.closest(".admin-link-record")){
    const email=prompt("Email dell’utente registrato:");
    if(!email)return;
    const {error}=await adminSupabase.rpc("admin_link_candidate_to_email",{
      p_candidate_id:candidateId,
      p_email:email.trim()
    });
    if(error)return alert(error.message);
    await loadAdminRecords();
  }
});


document.querySelector("#admin-records")?.addEventListener("change",event=>{
  const checkbox=event.target.closest(".admin-record-checkbox");
  if(!checkbox)return;
  const row=checkbox.closest(".admin-record-row");
  const candidateId=Number(row.dataset.candidateId);
  if(checkbox.checked)selectedAdminRecordIds.add(candidateId);
  else selectedAdminRecordIds.delete(candidateId);
  updateRecordSelectionUi();
});

document.querySelector("#admin-select-all-records")?.addEventListener("change",event=>{
  adminRecordsCache.forEach(record=>{
    const id=Number(record.candidate_id);
    if(event.target.checked)selectedAdminRecordIds.add(id);
    else selectedAdminRecordIds.delete(id);
  });
  loadAdminRecords();
});

document.querySelector("#admin-select-unlinked-records")?.addEventListener("click",()=>{
  adminRecordsCache.filter(record=>!record.email).forEach(record=>{
    selectedAdminRecordIds.add(Number(record.candidate_id));
  });
  document.querySelectorAll(".admin-record-row").forEach(row=>{
    const record=adminRecordsCache.find(item=>Number(item.candidate_id)===Number(row.dataset.candidateId));
    const checkbox=row.querySelector(".admin-record-checkbox");
    if(record&&!record.email&&checkbox)checkbox.checked=true;
  });
  updateRecordSelectionUi();
});

document.querySelector("#admin-clear-record-selection")?.addEventListener("click",()=>{
  selectedAdminRecordIds.clear();
  document.querySelectorAll(".admin-record-checkbox").forEach(checkbox=>checkbox.checked=false);
  updateRecordSelectionUi();
});

document.querySelector("#admin-delete-selected-records")?.addEventListener("click",async()=>{
  const ids=[...selectedAdminRecordIds];
  if(!ids.length)return;

  const linkedCount=adminRecordsCache.filter(record=>
    ids.includes(Number(record.candidate_id))&&Boolean(record.email)
  ).length;

  const warning=linkedCount
    ? ` Tra questi, ${linkedCount} ${linkedCount===1?"è associato":"sono associati"} a un account.`
    : "";

  if(!confirm(`Eliminare definitivamente ${ids.length} ${ids.length===1?"record":"record"}?${warning}\n\nL’operazione non può essere annullata.`))return;

  const {data,error}=await adminSupabase.rpc("admin_bulk_delete_candidates",{
    p_candidate_ids:ids
  });

  if(error)return alert(error.message);

  selectedAdminRecordIds.clear();
  alert(`${data||0} ${Number(data)===1?"record eliminato":"record eliminati"}.`);
  await Promise.all([loadAdminRecords(),loadDuplicates()]);
});

document.querySelector("#admin-add-edit-candidature")?.addEventListener("click",()=>adminAddEditCandidature());

document.querySelector("#admin-edit-candidatures")?.addEventListener("click",event=>{
  const button=event.target.closest(".admin-remove-edit-candidature");
  if(!button)return;
  const root=document.querySelector("#admin-edit-candidatures");
  if(root.children.length<=1){
    alert("Il record deve contenere almeno una candidatura.");
    return;
  }
  const row=button.closest(".admin-edit-candidature");
  const removedClass=row.querySelector(".admin-edit-class").value;
  row.remove();
  const remainingClasses=new Set([...document.querySelectorAll(".admin-edit-class")].map(node=>node.value));
  if(!remainingClasses.has(removedClass)){
    editingAdminPreferences=editingAdminPreferences.filter(pref=>pref.classe!==removedClass);
  }
  refreshAdminEditSchoolClasses();
  renderAdminEditSelectedSchools();
});

document.querySelector("#admin-edit-candidatures")?.addEventListener("change",event=>{
  if(!event.target.matches(".admin-edit-class"))return;
  refreshAdminEditSchoolClasses();
});

["admin-edit-school-class","admin-edit-school-province"].forEach(id=>{
  document.querySelector(`#${id}`)?.addEventListener("change",renderAdminEditSchoolSearch);
});
document.querySelector("#admin-edit-school-search")?.addEventListener("input",renderAdminEditSchoolSearch);

document.querySelector("#admin-edit-school-results")?.addEventListener("click",event=>{
  const button=event.target.closest(".admin-add-edit-school");
  if(!button||editingAdminPreferences.length>=30)return;
  editingAdminPreferences.push({
    classe:button.dataset.class,
    codice_scuola:button.dataset.code
  });
  renderAdminEditSelectedSchools();
});

document.querySelector("#admin-edit-selected-schools")?.addEventListener("click",event=>{
  const remove=event.target.closest(".admin-remove-edit-school");
  if(remove){
    editingAdminPreferences.splice(Number(remove.dataset.index),1);
    renderAdminEditSelectedSchools();
    return;
  }

  const move=event.target.closest(".admin-move-edit-school");
  if(move){
    const index=Number(move.dataset.index);
    const target=index+Number(move.dataset.dir);
    if(target>=0&&target<editingAdminPreferences.length){
      [editingAdminPreferences[index],editingAdminPreferences[target]]=[
        editingAdminPreferences[target],editingAdminPreferences[index]
      ];
      renderAdminEditSelectedSchools();
    }
  }
});

["admin-close-record-editor","admin-cancel-record-editor"].forEach(id=>{
  document.querySelector(`#${id}`)?.addEventListener("click",closeAdminRecordEditor);
});

document.querySelector("#admin-record-editor-form")?.addEventListener("submit",async event=>{
  event.preventDefault();
  if(!editingAdminRecord)return;

  const message=document.querySelector("#admin-record-editor-message");
  const button=event.submitter;
  const candidature=getAdminEditedCandidatures();

  if(!candidature.length||candidature.some(item=>
    !["AAAA","ADAA","EEEE","ADEE"].includes(item.classe)
    || !Number.isInteger(item.posizione)
    || item.posizione<1
    || !Number.isFinite(item.punteggio)
    || item.punteggio<0
  )){
    message.textContent="Controlla classi, posizioni e punteggi.";
    return;
  }

  const signatureSet=new Set(candidature.map(item=>`${item.classe}:${item.posizione}:${item.punteggio.toFixed(2)}`));
  if(signatureSet.size!==candidature.length){
    message.textContent="La stessa candidatura non può essere inserita due volte.";
    return;
  }

  const validClasses=new Set(candidature.map(item=>item.classe));
  if(editingAdminPreferences.some(pref=>!validClasses.has(pref.classe))){
    message.textContent="Rimuovi le preferenze associate a classi non più presenti.";
    return;
  }

  const preferences=editingAdminPreferences.map((pref,index)=>({
    classe:pref.classe,
    codice_scuola:pref.codice_scuola,
    ordine:index+1
  }));
  const locations=deriveAdminLocations(preferences);

  message.textContent="Salvataggio in corso…";
  if(button)button.disabled=true;

  const {error}=await adminSupabase.rpc("admin_update_candidate_record",{
    p_candidate_id:Number(editingAdminRecord.candidate_id),
    p_candidature:candidature,
    p_preferenze_scuole:preferences,
    p_account_email:document.querySelector("#admin-edit-record-email").value.trim()||null,
    p_provincia_1:locations.provincia1,
    p_provincia_2:locations.provincia2,
    p_comuni:locations.comuni
  });

  if(button)button.disabled=false;

  if(error){
    message.textContent=error.message;
    return;
  }

  closeAdminRecordEditor();
  await Promise.all([loadAdminRecords(),loadDuplicates()]);
});

document.querySelector("#admin-duplicates")?.addEventListener("click",async event=>{
  const group=event.target.closest(".admin-duplicate-group");

  if(event.target.closest(".admin-merge-duplicates")){
    if(!group)return;

    const ids=[...group.querySelectorAll(".admin-duplicate-record")]
      .map(row=>Number(row.dataset.candidateId));
    const primaryId=Number(
      group.querySelector(".admin-duplicate-primary-radio:checked")?.value
    );

    if(!primaryId||ids.length<2){
      alert("Seleziona il record principale da conservare.");
      return;
    }

    const sourceIds=ids.filter(id=>id!==primaryId);
    const primaryRow=group.querySelector(`.admin-duplicate-record[data-candidate-id="${primaryId}"]`);
    const primaryEmail=primaryRow?.querySelector("div > span")?.textContent||"";

    const warning=primaryEmail&&primaryEmail!=="Non associato a un account"
      ? `\n\nIl record principale è associato a: ${primaryEmail}`
      : "";

    if(!confirm(
      `Unire ${ids.length} record conservando il record #${primaryId}?`+
      `\n\nI record ${sourceIds.map(id=>"#"+id).join(", ")} saranno eliminati.`+
      warning+
      `\n\nL’operazione non può essere annullata.`
    ))return;

    const button=event.target.closest(".admin-merge-duplicates");
    button.disabled=true;
    button.textContent="Unione in corso…";

    const {data,error}=await adminSupabase.rpc("admin_merge_duplicate_candidates",{
      p_primary_candidate_id:primaryId,
      p_duplicate_candidate_ids:sourceIds
    });

    if(error){
      button.disabled=false;
      button.textContent="Unisci duplicati";
      alert(error.message);
      return;
    }

    alert(`Unione completata. Record conservato: #${data}.`);
    selectedAdminRecordIds.clear();
    await Promise.all([loadDuplicates(),loadAdminRecords()]);
    return;
  }

  const row=event.target.closest(".admin-duplicate-record");
  if(!row)return;
  const candidateId=Number(row.dataset.candidateId);

  if(event.target.closest(".admin-edit-duplicate")){
    event.preventDefault();
    await openAdminRecordEditor(candidateId);
    return;
  }

  if(event.target.closest(".admin-delete-duplicate")){
    if(!confirm(`Eliminare definitivamente il record #${candidateId}?`))return;
    const {error}=await adminSupabase.rpc("admin_delete_candidate",{p_candidate_id:candidateId});
    if(error)return alert(error.message);
    await Promise.all([loadDuplicates(),loadAdminRecords()]);
  }

  if(event.target.closest(".admin-link-duplicate")){
    const email=prompt("Email dell’utente registrato:");
    if(!email)return;
    const {error}=await adminSupabase.rpc("admin_link_candidate_to_email",{
      p_candidate_id:candidateId,
      p_email:email.trim()
    });
    if(error)return alert(error.message);
    await Promise.all([loadDuplicates(),loadAdminRecords()]);
  }
});
