const adminConfig = window.APP_CONFIG || {};
const adminSupabase = window.supabase.createClient(
  adminConfig.SUPABASE_URL,
  adminConfig.SUPABASE_KEY
);

let adminRequests = [];

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
    rejected: "Rifiutata"
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
    await Promise.all([loadAdminRequests(), loadAdminUsers(), loadAdminRecords(), loadDuplicates()]);
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
    matchesRoot.innerHTML = '<p class="admin-empty">Nessun record corrispondente trovato. Puoi rifiutare la richiesta oppure verificare manualmente in Supabase.</p>';
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

document.querySelector("#admin-login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const message = document.querySelector("#admin-login-message");
  message.textContent = "Accesso in corso…";

  const { data, error } = await adminSupabase.auth.signInWithPassword({
    email: document.querySelector("#admin-email").value.trim(),
    password: document.querySelector("#admin-password").value
  });

  if (error) {
    message.textContent = error.message;
    return;
  }

  message.textContent = "";
  await handleSession(data.session);
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
  const { data } = await adminSupabase.auth.getSession();
  await handleSession(data.session);
})();




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
    p_linked_status:document.querySelector("#admin-filter-linked")?.value||"all"
  };
}

function renderCandidatureSummary(candidature){
  return (candidature||[]).map(item=>
    `${adminEscape(item.classe)} · posizione ${adminEscape(item.posizione)} · ${adminEscape(item.punteggio)} punti`
  ).join("<br>");
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

  const records=data||[];
  countRoot.textContent=`${records.length} ${records.length===1?"record trovato":"record trovati"}`;

  root.innerHTML=records.length?records.map(record=>`
    <article class="admin-record-row" data-candidate-id="${record.candidate_id}">
      <div class="admin-record-row__main">
        <div class="admin-record-row__title">
          <strong>Record #${record.candidate_id}</strong>
          <span class="badge ${record.email?"badge--linked":"badge--unlinked"}">
            ${record.email?"Associato":"Non associato"}
          </span>
        </div>
        <span>${record.email?adminEscape(record.email):"Nessun account collegato"}</span>
        <div class="admin-record-candidatures">${renderCandidatureSummary(record.candidature)}</div>
        <small>Comuni storici: ${(record.comuni||[]).length?(record.comuni||[]).map(adminEscape).join(" · "):"—"}</small>
        <small>${record.preferences_count} preferenze scolastiche · aggiornato ${adminDate(record.updated_at||record.created_at)}</small>
      </div>
      <div class="admin-record-row__actions">
        ${record.email?"":'<button class="secondary admin-link-record" type="button">Associa a email</button>'}
        <button class="danger-button admin-delete-record" type="button">Elimina</button>
      </div>
    </article>`).join(""):'<p class="admin-empty">Nessun record corrisponde ai filtri selezionati.</p>';
}

async function loadDuplicates(){
  const root=document.querySelector("#admin-duplicates");
  const countRoot=document.querySelector("#admin-duplicate-count");
  if(!root)return;

  root.innerHTML='<p class="admin-empty">Ricerca dei duplicati…</p>';

  const {data,error}=await adminSupabase.rpc("admin_find_possible_duplicates_detailed");
  if(error){
    root.innerHTML=`<p class="admin-empty">${adminEscape(error.message)}</p>`;
    countRoot.textContent="Errore";
    return;
  }

  const groups=data||[];
  countRoot.textContent=`${groups.length} ${groups.length===1?"gruppo":"gruppi"}`;

  root.innerHTML=groups.length?groups.map((group,index)=>`
    <article class="admin-duplicate-group">
      <header>
        <div>
          <strong>Gruppo ${index+1}</strong>
          <span>${adminEscape(group.signature)}</span>
        </div>
        <span class="badge">${group.record_count} record</span>
      </header>
      <div class="admin-duplicate-records">
        ${(group.records||[]).map(record=>`
          <div class="admin-duplicate-record" data-candidate-id="${record.candidate_id}">
            <div>
              <strong>Record #${record.candidate_id}</strong>
              <span>${record.email?adminEscape(record.email):"Non associato a un account"}</span>
              <small>${(record.comuni||[]).map(adminEscape).join(" · ")||"Nessun comune storico"}</small>
              <small>${record.preferences_count||0} preferenze scolastiche · ${adminDate(record.updated_at||record.created_at)}</small>
            </div>
            <div class="admin-record-row__actions">
              ${record.email?"":'<button class="secondary admin-link-duplicate" type="button">Associa</button>'}
              <button class="danger-button admin-delete-duplicate" type="button">Elimina</button>
            </div>
          </div>`).join("")}
      </div>
    </article>`).join(""):'<p class="admin-empty">Nessun duplicato esatto rilevato.</p>';
}

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

document.querySelector("#admin-duplicates")?.addEventListener("click",async event=>{
  const row=event.target.closest(".admin-duplicate-record");
  if(!row)return;
  const candidateId=Number(row.dataset.candidateId);

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
