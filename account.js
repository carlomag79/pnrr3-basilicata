if (!window.supabase || typeof window.supabase.createClient !== "function") {
  const startupMessage = document.getElementById("auth-message");
  if (startupMessage) startupMessage.textContent = "La libreria di accesso non è stata caricata. Ricarica la pagina con Ctrl + F5.";
  throw new Error("Supabase JS non disponibile");
}

if (!window.APP_CONFIG?.SUPABASE_URL || !window.APP_CONFIG?.SUPABASE_KEY) {
  const startupMessage = document.getElementById("auth-message");
  if (startupMessage) startupMessage.textContent = "Configurazione Supabase non disponibile. Ricarica la pagina.";
  throw new Error("Configurazione Supabase mancante");
}

const cfg = window.APP_CONFIG || {};
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);

let allSchools = [];
let selectedSchools = [];
let currentSubmission = null;
let lastLegacyImport = false;
let pendingOtpEmail = "";
let registrationStatus = null;
let supportSelectedSchools = [];

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
const classes = {
  AAAA: "Infanzia posto comune",
  ADAA: "Infanzia sostegno",
  EEEE: "Primaria posto comune",
  ADEE: "Primaria sostegno"
};

function normalizeLegacyCode(value){
  return String(value||"").trim().toUpperCase().replace(/\s+/g,"");
}
function randomCode(prefix){
  const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes=new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const token=[...bytes].map(byte=>alphabet[byte%alphabet.length]).join("");
  return `${prefix}-${token.slice(0,4)}-${token.slice(4)}`;
}
function setLegacyMessage(message,isError=false){
  const el=$("#legacy-import-message");
  el.textContent=message;
  el.className=`account-feedback ${isError?"error":"success"}`;
}
async function importLegacySubmission(){
  const code=normalizeLegacyCode($("#account-legacy-code").value);
  if(!/^PNRR3-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)){
    return setLegacyMessage("Inserisci un codice PNRR3 valido.",true);
  }
  setLegacyMessage("Importazione in corso…");
  const {data,error}=await sb.rpc("link_legacy_submission_to_current_user",{p_edit_code:code});
  if(error)return setLegacyMessage(error.message,true);
  if(!data)return setLegacyMessage("Codice non riconosciuto o compilazione già associata.",true);
  lastLegacyImport=true;
  setLegacyMessage("Compilazione importata. Ora scegli le singole scuole e salva.");
  await loadMine();
}
async function submitAccountClaim(){
  const position=Number($("#account-claim-position").value);
  const score=Number($("#account-claim-score").value);
  const municipality=$("#account-claim-municipality").value.trim();

  if(!Number.isInteger(position)||position<1||!Number.isFinite(score)||score<0||!municipality){
    return setLegacyMessage("Completa correttamente i dati della richiesta.",true);
  }

  setLegacyMessage("Invio della richiesta…");
  const {data,error}=await sb.rpc("submit_my_legacy_claim",{
    p_classe:$("#account-claim-class").value,
    p_posizione:position,
    p_punteggio:score,
    p_primo_comune:municipality
  });

  if(error)return setLegacyMessage(error.message,true);
  setLegacyMessage("Richiesta inviata. Dopo l’approvazione il record comparirà automaticamente nella tua area personale.");
  await checkAccountClaim();
}

async function checkAccountClaim(){
  const statusRoot=$("#account-claim-status");
  const {data,error}=await sb.rpc("get_my_legacy_claim");
  if(error){
    statusRoot.textContent=error.message;
    return;
  }

  const status=Array.isArray(data)?data[0]:data;
  if(!status){
    statusRoot.innerHTML="<p>Nessuna richiesta inviata da questo account.</p>";
    return;
  }

  if(status.status==="pending"){
    statusRoot.innerHTML="<p><strong>Richiesta in attesa.</strong> Un amministratore deve ancora verificarla.</p>";
    return;
  }

  if(status.status==="rejected"){
    statusRoot.innerHTML=`<p><strong>Richiesta non approvata.</strong> ${esc(status.admin_note||"Controlla i dati e contatta un amministratore.")}</p>`;
    return;
  }

  statusRoot.innerHTML="<p><strong>Richiesta approvata.</strong> La compilazione è stata collegata al tuo account.</p>";
  await loadMine();
}
function provinceFromCode(code){return String(code).startsWith("MT")?"Matera":"Potenza"}
function availablePosts(school, code){const n=Number(school.disponibilita?.[code]);return Number.isFinite(n)&&n>0?n:0}

function addCandidature(data={classe:"EEEE",posizione:"",punteggio:""}){
  const root=$("#account-candidatures");
  const row=document.createElement("div");
  row.className="account-candidature";
  row.innerHTML=`
    <label>Classe<select class="account-class">${Object.entries(classes).map(([code,label])=>`<option value="${code}"${data.classe===code?" selected":""}>${code} – ${label}</option>`).join("")}</select></label>
    <label>Posizione<input class="account-position" type="number" min="1" step="1" value="${esc(data.posizione)}" required></label>
    <label>Punteggio<input class="account-score" type="number" min="0" step="0.01" value="${esc(data.punteggio)}" required></label>
    <button class="remove-account-candidature secondary" type="button" aria-label="Rimuovi classe">×</button>`;
  root.appendChild(row);
  refreshSchoolClassFilter();
}

function getCandidatures(){
  return [...document.querySelectorAll(".account-candidature")].map(row=>({
    classe:row.querySelector(".account-class").value,
    posizione:Number(row.querySelector(".account-position").value),
    punteggio:Number(row.querySelector(".account-score").value)
  }));
}

function refreshSchoolClassFilter(){
  const select=$("#school-class-filter");
  const current=select.value;
  const used=[...new Set([...document.querySelectorAll(".account-class")].map(el=>el.value))];
  select.innerHTML=used.map(code=>`<option value="${code}">${code} – ${classes[code]}</option>`).join("");
  if(used.includes(current))select.value=current;
  renderSchoolSearch();
}

function renderSchoolSearch(){
  const code=$("#school-class-filter").value;
  const province=$("#school-province-filter").value;
  const q=$("#school-search").value.trim().toLocaleLowerCase("it-IT");
  const root=$("#school-search-results");
  if(!code){root.innerHTML='<p class="updates-empty">Aggiungi prima una classe.</p>';return}
  const matches=allSchools.filter(s=>{
    const posts=availablePosts(s,code);
    const hay=`${s.denominazione} ${s.comune} ${s.istituto}`.toLocaleLowerCase("it-IT");
    return posts>0&&(!province||s.provincia===province)&&(!q||hay.includes(q))&&!selectedSchools.some(p=>p.codice===s.codice&&p.classe===code);
  }).slice(0,60);
  root.innerHTML=matches.length?matches.map(s=>`
    <article class="school-result">
      <div><strong>${esc(s.denominazione)} – ${esc(s.comune)}</strong><span>${esc(s.istituto)}</span><small>${s.codice}</small><span class="school-result__posts">${availablePosts(s,code)} ${availablePosts(s,code)===1?"posto":"posti"} ${code}</span></div>
      <button class="secondary add-school" type="button" data-code="${s.codice}" data-class="${code}">Aggiungi</button>
    </article>`).join(""):'<p class="updates-empty">Nessuna scuola disponibile per questi criteri.</p>';
}

function renderSelected(){
  const root=$("#selected-schools");
  $("#school-counter").textContent=`${selectedSchools.length} / 30`;
  root.innerHTML=selectedSchools.length?selectedSchools.map((p,i)=>{
    const s=allSchools.find(x=>x.codice===p.codice_scuola);
    if(!s)return "";
    return `<article class="selected-school">
      <span class="selected-school__number">${i+1}</span>
      <div><strong><span class="class-chip ${p.classe}">${p.classe}</span> ${esc(s.denominazione)} – ${esc(s.comune)}</strong><span>${esc(s.istituto)} · ${availablePosts(s,p.classe)} posti ufficiali</span></div>
      <div class="selected-school__actions">
        <button class="secondary move-school" data-index="${i}" data-dir="-1" type="button" aria-label="Sposta su">↑</button>
        <button class="secondary move-school" data-index="${i}" data-dir="1" type="button" aria-label="Sposta giù">↓</button>
        <button class="danger-button remove-school" data-index="${i}" type="button" aria-label="Rimuovi">×</button>
      </div>
    </article>`;
  }).join(""):'<p class="updates-empty">Non hai ancora aggiunto scuole.</p>';
  renderSchoolSearch();
}

async function loadSchools(){
  const response=await fetch("scuole.json",{cache:"no-store"});
  if(!response.ok)throw new Error("Impossibile caricare le scuole.");
  allSchools=await response.json();
}

async function getRegistrationStatus(){
  const {data,error}=await sb.rpc("get_my_registration_request");
  if(error)throw error;
  return Array.isArray(data)?data[0]:data;
}

function showRegistrationState(status){
  const panel=$("#registration-panel");
  const editor=$("#account-editor");
  const legacy=$("#legacy-import-panel");
  const badge=$("#registration-status-badge");
  const message=$("#registration-message");

  registrationStatus=status;
  panel.hidden=false;
  editor.hidden=true;
  legacy.hidden=false;

  if(!status){
    badge.textContent="Da compilare";
    message.innerHTML="<p>Puoi richiedere l’abilitazione oppure, se avevi già compilato il vecchio form, rivendicare il record esistente qui sotto.</p>";
    $("#registration-request-form").hidden=false;
    return;
  }

  $("#registration-class").value=status.classe;
  $("#registration-position").value=status.posizione;
  $("#registration-score").value=status.punteggio;

  if(status.status==="pending"){
    badge.textContent="In verifica";
    $("#registration-request-form").hidden=true;
    message.innerHTML="<p><strong>Richiesta inviata.</strong> Attendi l’approvazione di un amministratore.</p>";
    return;
  }

  if(status.status==="rejected"){
    badge.textContent="Non approvata";
    $("#registration-request-form").hidden=false;
    message.innerHTML=`<p><strong>Richiesta non approvata.</strong> ${esc(status.admin_note||"Controlla i dati e invia nuovamente la richiesta.")}</p>`;
    return;
  }

  if(status.status==="approved"){
    badge.textContent="Approvata";
    panel.hidden=true;
    editor.hidden=false;
  }
}


async function loadAccountMessages(){
  const root=$("#account-messages-list");
  const badge=$("#account-unread-messages");
  if(!root||!badge)return;

  const {data,error}=await sb.rpc("get_my_user_messages");
  if(error){
    root.innerHTML=`<p class="admin-empty">${esc(error.message)}</p>`;
    return;
  }

  const messages=data||[];
  const unread=messages.filter(message=>!message.read_at).length;
  badge.textContent=`${unread} ${unread===1?"non letto":"non letti"}`;

  root.innerHTML=messages.length?messages.map(message=>`
    <article class="account-message-card ${message.read_at?"":"is-unread"}" data-message-id="${message.id}">
      <header>
        <div>
          <strong>${esc(message.subject)}</strong>
          <span>${new Date(message.created_at).toLocaleString("it-IT",{dateStyle:"short",timeStyle:"short"})}</span>
        </div>
        ${message.read_at?"":'<button class="secondary account-mark-message-read" type="button">Segna come letto</button>'}
      </header>
      <p>${esc(message.body).replaceAll("\\n","<br>")}</p>
    </article>`).join(""):'<p class="admin-empty">Nessun messaggio ricevuto.</p>';
}

async function loadMine(){
  const {data,error}=await sb.rpc("get_my_candidatura_v2");
  if(error)throw error;
  currentSubmission=Array.isArray(data)?data[0]:data;
  $("#account-candidatures").innerHTML="";

  if(currentSubmission){
    $("#registration-panel").hidden=true;
    $("#account-editor").hidden=false;
    $("#legacy-import-panel").hidden=true;
    (currentSubmission.candidature||[]).forEach(addCandidature);
    selectedSchools=(currentSubmission.preferenze_scuole||[]).map(x=>({classe:x.classe,codice_scuola:x.codice_scuola}));
  }else{
    const status=await getRegistrationStatus();
    showRegistrationState(status);

    if(status?.status==="approved"){
      addCandidature({
        classe:status.classe,
        posizione:status.posizione,
        punteggio:status.punteggio
      });
    }else{
      addCandidature();
    }
    selectedSchools=[];
    await checkAccountClaim();
  }

  $("#legacy-school-note").hidden=!(lastLegacyImport || (currentSubmission && (!currentSubmission.preferenze_scuole || !currentSubmission.preferenze_scuole.length)));
  renderSelected();
}

async function handleSession(session){
  if(!session){
    $("#auth-panel").hidden=false;
    $("#account-app").hidden=true;
    return;
  }
  $("#auth-panel").hidden=true;
  $("#account-app").hidden=false;
  $("#account-email").textContent=session.user.email||"Utente autenticato";
  const {error:preregisterError}=await sb.rpc("claim_my_preregistered_candidate");
  if(preregisterError)console.warn("Associazione pre-registrazione:",preregisterError.message);
  await Promise.all([loadMine(),loadAccountMessages()]);
}

async function signInWithProvider(provider){
  const message=$("#social-login-message");
  message.textContent="Reindirizzamento al provider…";

  const redirectTo=new URL("account.html",window.location.href).href;
  const options={redirectTo};

  if(provider==="azure"){
    options.scopes="openid email profile";
  }

  const {error}=await sb.auth.signInWithOAuth({provider,options});
  if(error){
    message.textContent=error.message||"Non è stato possibile avviare l’accesso.";
  }
}

$("#login-google").addEventListener("click",()=>signInWithProvider("google"));

async function requestOtp(email,createUser=true){
  return sb.auth.signInWithOtp({
    email,
    options:{shouldCreateUser:createUser}
  });
}

$("#otp-request-form").addEventListener("submit",async event=>{
  event.preventDefault();
  const email=$("#auth-email").value.trim();
  const message=$("#auth-message");
  const button=event.submitter;
  message.textContent="Invio del codice…";
  if(button)button.disabled=true;

  try{
    const {error}=await requestOtp(email,true);
    if(error)throw error;
  }catch(error){
    message.textContent=error?.message||"Non è stato possibile inviare il codice.";
    if(button)button.disabled=false;
    return;
  }

  if(button)button.disabled=false;
  pendingOtpEmail=email;
  message.textContent="Codice inviato. Controlla anche Spam, Promozioni o la webmail del tuo provider.";
  $("#otp-request-form").hidden=true;
  $("#otp-verify-form").hidden=false;
  $("#auth-otp").focus();
});

$("#otp-verify-form").addEventListener("submit",async event=>{
  event.preventDefault();
  const token=$("#auth-otp").value.trim().replace(/\s+/g,"");
  $("#otp-message").textContent="Verifica in corso…";

  const {error}=await sb.auth.verifyOtp({
    email:pendingOtpEmail,
    token,
    type:"email"
  });

  $("#otp-message").textContent=error?error.message:"Accesso effettuato.";
});

$("#auth-change-email").addEventListener("click",()=>{
  pendingOtpEmail="";
  $("#auth-otp").value="";
  $("#otp-verify-form").hidden=true;
  $("#otp-request-form").hidden=false;
  $("#auth-message").textContent="";
});

$("#registration-request-form").addEventListener("submit",async event=>{
  event.preventDefault();

  const posizione=Number($("#registration-position").value);
  const punteggio=Number($("#registration-score").value);
  const message=$("#registration-message");

  if(!Number.isInteger(posizione)||posizione<1||!Number.isFinite(punteggio)||punteggio<0){
    message.innerHTML="<p>Controlla posizione e punteggio.</p>";
    return;
  }

  message.innerHTML="<p>Verifica dei dati in corso…</p>";
  const {data,error}=await sb.rpc("submit_candidate_registration_request",{
    p_classe:$("#registration-class").value,
    p_posizione:posizione,
    p_punteggio:punteggio
  });

  if(error){
    message.innerHTML=`<p>${esc(error.message)}</p>`;
    return;
  }

  const result=typeof data==="string"?JSON.parse(data):data;
  if(result.result==="existing_record"){
    message.innerHTML="<p><strong>Esiste già un record con questi dati.</strong> Non è stata creata una nuova iscrizione. Usa la sezione sottostante per rivendicare la vecchia compilazione.</p>";
    $("#legacy-import-panel").hidden=false;
    return;
  }

  await loadMine();
});

$("#import-legacy-submission").addEventListener("click",importLegacySubmission);
$("#account-submit-claim").addEventListener("click",submitAccountClaim);
$("#account-check-claim").addEventListener("click",checkAccountClaim);
$("#account-legacy-code").addEventListener("keydown",event=>{if(event.key==="Enter")importLegacySubmission()});


$("#account-messages-list")?.addEventListener("click",async event=>{
  const button=event.target.closest(".account-mark-message-read");
  if(!button)return;
  const card=button.closest(".account-message-card");
  const {error}=await sb.rpc("mark_my_user_message_read",{
    p_message_id:Number(card.dataset.messageId)
  });
  if(error){
    alert(error.message);
    return;
  }
  await loadAccountMessages();
});

$("#account-logout").addEventListener("click",()=>sb.auth.signOut());
$("#add-account-candidature").addEventListener("click",()=>{if(document.querySelectorAll(".account-candidature").length<4)addCandidature()});
$("#account-candidatures").addEventListener("click",e=>{if(e.target.closest(".remove-account-candidature")){if(document.querySelectorAll(".account-candidature").length>1)e.target.closest(".account-candidature").remove();refreshSchoolClassFilter()}});
$("#account-candidatures").addEventListener("change",e=>{if(e.target.matches(".account-class"))refreshSchoolClassFilter()});
["school-class-filter","school-province-filter"].forEach(id=>$("#"+id).addEventListener("change",renderSchoolSearch));
$("#school-search").addEventListener("input",renderSchoolSearch);

$("#school-search-results").addEventListener("click",e=>{
  const b=e.target.closest(".add-school");if(!b||selectedSchools.length>=30)return;
  selectedSchools.push({classe:b.dataset.class,codice_scuola:b.dataset.code});renderSelected();
});
$("#selected-schools").addEventListener("click",e=>{
  const remove=e.target.closest(".remove-school");
  if(remove){selectedSchools.splice(Number(remove.dataset.index),1);renderSelected();return}
  const move=e.target.closest(".move-school");
  if(move){const i=Number(move.dataset.index),j=i+Number(move.dataset.dir);if(j>=0&&j<selectedSchools.length){[selectedSchools[i],selectedSchools[j]]=[selectedSchools[j],selectedSchools[i]];renderSelected()}}
});

$("#account-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const candidature=getCandidatures();
  if(candidature.some(x=>!Number.isInteger(x.posizione)||x.posizione<1||!Number.isFinite(x.punteggio)||x.punteggio<0)){return $("#account-message").textContent="Controlla posizione e punteggio."}
  if(!selectedSchools.length)return $("#account-message").textContent="Aggiungi almeno una scuola.";
  const validClasses=new Set(candidature.map(x=>x.classe));
  if(selectedSchools.some(x=>!validClasses.has(x.classe)))return $("#account-message").textContent="Rimuovi le preferenze associate a classi non più presenti.";
  $("#save-status").textContent="Salvataggio…";
  const prefs=selectedSchools.map((x,i)=>({...x,ordine:i+1}));
  const {data,error}=await sb.rpc("upsert_my_candidatura_v2",{p_candidature:candidature,p_preferenze_scuole:prefs});
  $("#save-status").textContent=error?"Errore":"Salvato";
  $("#account-message").textContent=error?error.message:"Preferenze aggiornate correttamente.";
});

$("#delete-account-data").addEventListener("click",async()=>{
  if(!confirm("Eliminare definitivamente i dati della tua partecipazione?"))return;
  const {data,error}=await sb.rpc("delete_my_candidatura_v2");
  if(error)return $("#account-message").textContent=error.message;
  selectedSchools=[];$("#account-candidatures").innerHTML="";addCandidature();renderSelected();$("#account-message").textContent="Dati eliminati.";
});



function renderSupportSchoolSearch(){
  const root=$("#support-school-results");
  if(!root)return;

  const classe=$("#support-class").value;
  const q=$("#support-school-search").value.trim().toLocaleLowerCase("it-IT");

  const matches=allSchools.filter(s=>{
    const posts=availablePosts(s,classe);
    const hay=`${s.denominazione} ${s.comune} ${s.istituto} ${s.codice}`.toLocaleLowerCase("it-IT");
    return posts>0
      && (!q||hay.includes(q))
      && !supportSelectedSchools.some(item=>item.codice_scuola===s.codice);
  }).slice(0,60);

  root.innerHTML=matches.length?matches.map(s=>`
    <article class="school-result">
      <div>
        <strong>${esc(s.denominazione)} – ${esc(s.comune)}</strong>
        <span>${esc(s.istituto)}</span>
        <small>${s.codice}</small>
        <span class="school-result__posts">${availablePosts(s,classe)} ${availablePosts(s,classe)===1?"posto":"posti"} disponibili</span>
      </div>
      <button class="secondary support-add-school" type="button" data-code="${s.codice}">Aggiungi</button>
    </article>
  `).join(""):'<p class="updates-empty">Nessuna scuola con disponibilità per questi criteri.</p>';
}

function renderSupportSelectedSchools(){
  const root=$("#support-selected-schools");
  if(!root)return;

  $("#support-school-counter").textContent=`${supportSelectedSchools.length} / 30`;

  root.innerHTML=supportSelectedSchools.length?supportSelectedSchools.map((item,index)=>{
    const school=allSchools.find(s=>s.codice===item.codice_scuola);
    if(!school)return "";
    return `
      <article class="selected-school">
        <span class="selected-school__number">${index+1}</span>
        <div>
          <strong>${esc(school.denominazione)} – ${esc(school.comune)}</strong>
          <span>${esc(school.istituto)} · ${availablePosts(school,item.classe)} posti disponibili</span>
        </div>
        <div class="selected-school__actions">
          <button class="secondary support-move-school" data-index="${index}" data-dir="-1" type="button" aria-label="Sposta su">↑</button>
          <button class="secondary support-move-school" data-index="${index}" data-dir="1" type="button" aria-label="Sposta giù">↓</button>
          <button class="danger-button support-remove-school" data-index="${index}" type="button" aria-label="Rimuovi">×</button>
        </div>
      </article>`;
  }).join(""):'<p class="updates-empty">Seleziona almeno una scuola.</p>';

  renderSupportSchoolSearch();
}

$("#support-class").addEventListener("change",()=>{
  supportSelectedSchools=[];
  renderSupportSelectedSchools();
});

$("#support-school-search").addEventListener("input",renderSupportSchoolSearch);

$("#support-school-results").addEventListener("click",event=>{
  const button=event.target.closest(".support-add-school");
  if(!button||supportSelectedSchools.length>=30)return;
  supportSelectedSchools.push({
    classe:$("#support-class").value,
    codice_scuola:button.dataset.code
  });
  renderSupportSelectedSchools();
});

$("#support-selected-schools").addEventListener("click",event=>{
  const remove=event.target.closest(".support-remove-school");
  if(remove){
    supportSelectedSchools.splice(Number(remove.dataset.index),1);
    renderSupportSelectedSchools();
    return;
  }

  const move=event.target.closest(".support-move-school");
  if(move){
    const index=Number(move.dataset.index);
    const target=index+Number(move.dataset.dir);
    if(target>=0&&target<supportSelectedSchools.length){
      [supportSelectedSchools[index],supportSelectedSchools[target]]=[
        supportSelectedSchools[target],supportSelectedSchools[index]
      ];
      renderSupportSelectedSchools();
    }
  }
});

$("#manual-support-form").addEventListener("submit",async event=>{
  event.preventDefault();

  const button=event.submitter;
  const message=$("#manual-support-message");
  const posizione=Number($("#support-position").value);
  const punteggio=Number($("#support-score").value);

  if(!Number.isInteger(posizione)||posizione<1||!Number.isFinite(punteggio)||punteggio<0){
    message.textContent="Controlla posizione e punteggio.";
    return;
  }

  if(!supportSelectedSchools.length){
    message.textContent="Seleziona almeno una scuola con disponibilità.";
    return;
  }

  message.textContent="Invio della richiesta…";
  if(button)button.disabled=true;

  const {data,error}=await sb.rpc("submit_manual_support_request",{
    p_email:$("#support-email").value.trim(),
    p_contact_email:$("#support-contact-email").value.trim()||null,
    p_classe:$("#support-class").value,
    p_posizione:posizione,
    p_punteggio:punteggio,
    p_issue:$("#support-issue").value,
    p_note:$("#support-note").value.trim()||null,
    p_preferenze_scuole:supportSelectedSchools.map((item,index)=>({...item,ordine:index+1})),
    p_website:$("#support-website").value
  });

  if(button)button.disabled=false;

  if(error){
    message.textContent=error.message||"Non è stato possibile inviare la richiesta.";
    return;
  }

  event.target.reset();
  supportSelectedSchools=[];
  renderSupportSelectedSchools();
  message.textContent="Richiesta inviata. Sarà verificata manualmente; verrai ricontattato all’indirizzo indicato.";
});

sb.auth.onAuthStateChange((_event,session)=>handleSession(session));
(async()=>{await loadSchools();renderSupportSelectedSchools();const {data}=await sb.auth.getSession();await handleSession(data.session)})();