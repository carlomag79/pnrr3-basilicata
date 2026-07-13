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
    await loadAdminRequests();
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
      <span class="admin-match__meta">Inserito ${adminDate(match.created_at)}</span>
    </label>
  `).join("") + `
    <div class="admin-request__actions">
      <button class="primary admin-approve" type="button">Approva e genera codice</button>
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

  window.alert(`Richiesta approvata. Codice generato: ${data}`);
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


