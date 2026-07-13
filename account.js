const cfg = window.APP_CONFIG || {};
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);

let allSchools = [];
let selectedSchools = [];
let currentSubmission = null;
let lastLegacyImport = false;

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
  const requestCode=randomCode("CLAIM");
  const {data,error}=await sb.rpc("submit_legacy_claim_request",{
    p_request_code:requestCode,
    p_classe:$("#account-claim-class").value,
    p_posizione:position,
    p_punteggio:score,
    p_primo_comune:municipality
  });
  if(error)return setLegacyMessage(error.message,true);
  $("#account-claim-code").value=requestCode;
  setLegacyMessage(`Richiesta inviata. Conserva il codice ${requestCode}.`);
}
async function checkAccountClaim(){
  const code=normalizeLegacyCode($("#account-claim-code").value);
  if(!/^CLAIM-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)){
    return setLegacyMessage("Inserisci un codice CLAIM valido.",true);
  }
  const {data,error}=await sb.rpc("check_legacy_claim_request",{p_request_code:code});
  if(error)return setLegacyMessage(error.message,true);
  const status=Array.isArray(data)?data[0]:data;
  if(!status)return setLegacyMessage("Richiesta non trovata.",true);
  if(status.status==="pending")return setLegacyMessage("La richiesta è ancora in attesa di verifica.");
  if(status.status==="rejected")return setLegacyMessage(status.admin_note||"La richiesta non è stata approvata.",true);
  if(status.status==="approved"&&status.edit_code){
    $("#account-legacy-code").value=status.edit_code;
    return setLegacyMessage(`Richiesta approvata. Premi “Importa compilazione” per collegare il codice ${status.edit_code}.`);
  }
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

async function loadMine(){
  const {data,error}=await sb.rpc("get_my_candidatura_v2");
  if(error)throw error;
  currentSubmission=Array.isArray(data)?data[0]:data;
  $("#account-candidatures").innerHTML="";
  if(currentSubmission){
    (currentSubmission.candidature||[]).forEach(addCandidature);
    selectedSchools=(currentSubmission.preferenze_scuole||[]).map(x=>({classe:x.classe,codice_scuola:x.codice_scuola}));
  }else{
    addCandidature();
    selectedSchools=[];
  }

  const importPanel=$("#legacy-import-panel");
  importPanel.hidden=Boolean(currentSubmission);
  $("#legacy-school-note").hidden=!(lastLegacyImport || (currentSubmission && (!currentSubmission.preferenze_scuole || !currentSubmission.preferenze_scuole.length)));
  renderSelected();
}

async function handleSession(session){
  if(!session){
    $("#auth-panel").hidden=false;$("#account-app").hidden=true;return;
  }
  $("#auth-panel").hidden=true;$("#account-app").hidden=false;
  $("#account-email").textContent=session.user.email||"Utente autenticato";
  await loadMine();
}

$("#import-legacy-submission").addEventListener("click",importLegacySubmission);
$("#account-submit-claim").addEventListener("click",submitAccountClaim);
$("#account-check-claim").addEventListener("click",checkAccountClaim);
$("#account-legacy-code").addEventListener("keydown",event=>{if(event.key==="Enter")importLegacySubmission()});
$("#account-claim-code").addEventListener("keydown",event=>{if(event.key==="Enter")checkAccountClaim()});

$("#magic-link-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const email=$("#auth-email").value.trim();
  $("#auth-message").textContent="Invio del link…";
  const {error}=await sb.auth.signInWithOtp({email,options:{emailRedirectTo:new URL("account.html",window.location.href).href}});
  $("#auth-message").textContent=error?error.message:"Controlla la tua email: il link di accesso è stato inviato.";
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

sb.auth.onAuthStateChange((_event,session)=>handleSession(session));
(async()=>{await loadSchools();const {data}=await sb.auth.getSession();await handleSession(data.session)})();