if(!window.supabase||!window.APP_CONFIG?.SUPABASE_URL||!window.APP_CONFIG?.SUPABASE_KEY){
  document.querySelector("#admin-login-message").textContent="Configurazione non disponibile.";
  throw new Error("Configurazione Supabase mancante");
}
const sb=window.supabase.createClient(window.APP_CONFIG.SUPABASE_URL,window.APP_CONFIG.SUPABASE_KEY);
let pendingEmail="";
const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const login=document.querySelector("#admin-login-panel");
const app=document.querySelector("#admin-assignments-app");
const logout=document.querySelector("#admin-logout");

async function verifyAdmin(){
  const {data,error}=await sb.rpc("admin_is_current_user");
  if(error)throw error;
  return Boolean(data);
}
async function handleSession(session){
  if(!session){login.hidden=false;app.hidden=true;logout.hidden=true;return}
  try{
    if(!await verifyAdmin())throw new Error("Account non autorizzato.");
    login.hidden=true;app.hidden=false;logout.hidden=false;
    await loadAssignments();
  }catch(error){
    await sb.auth.signOut();
    document.querySelector("#admin-login-message").textContent=error.message;
  }
}
async function loadAssignments(){
  const root=document.querySelector("#assignment-list");
  root.innerHTML='<p class="admin-empty">Caricamento assegnazioni…</p>';
  const {data,error}=await sb.rpc("admin_list_official_assignments",{
    p_class:document.querySelector("#assignment-class").value||null,
    p_status:document.querySelector("#assignment-status").value||"all",
    p_query:document.querySelector("#assignment-query").value.trim()||null
  });
  if(error){root.innerHTML=`<p class="admin-empty">${esc(error.message)}</p>`;return}
  const rows=data||[];
  const counts=rows.reduce((acc,row)=>(acc[row.match_status]=(acc[row.match_status]||0)+1,acc),{});
  document.querySelector("#assignment-summary").innerHTML=`
    <span class="badge">${rows.length} risultati</span>
    <span class="badge">Automatici ${counts.automatic||0}</span>
    <span class="badge">Confermati ${Number(counts.confirmed||0)+Number(counts.manual||0)}</span>
    <span class="badge">Ambigui ${counts.ambiguous||0}</span>
    <span class="badge">Non abbinati ${counts.unmatched||0}</span>`;
  root.innerHTML=rows.length?rows.map(row=>`
    <article class="admin-record-row assignment-row" data-id="${row.assignment_id}" data-candidate="${row.candidate_id||""}">
      <div class="admin-record-row__main">
        <div class="admin-record-row__title">
          <strong>${esc(row.insegnamento)} · posizione ${row.posizione} · ${Number(row.punteggio).toFixed(2)}</strong>
          <span class="badge">${esc(row.esito)}</span>
          <span class="badge assignment-status assignment-status--${esc(row.match_status)}">${esc(row.match_status)}</span>
        </div>
        <span>${esc(row.cognome)} ${esc(row.nome)}</span>
        <span>${esc(row.provincia_assegnata)} · ${esc(row.codice_scuola)} · ${esc(row.denominazione_scuola)}</span>
        <small>${row.candidate_id?`Record #${row.candidate_id}${row.user_email?` · ${esc(row.user_email)}`:""}`:"Nessun record associato"}${row.preference_position?` · preferenza n. ${row.preference_position}`:" · scuola non presente tra le preferenze"}</small>
      </div>
      <div class="admin-record-row__actions">
        ${row.match_status==="automatic"?'<button class="primary confirm-assignment" type="button">Conferma</button>':""}
        ${["confirmed","manual"].includes(row.match_status)?'<button class="danger-button unlink-assignment" type="button">Scollega</button>':""}
        ${["unmatched","ambiguous"].includes(row.match_status)?'<button class="secondary manual-assignment" type="button">Associa a record</button>':""}
      </div>
    </article>`).join(""):'<p class="admin-empty">Nessuna assegnazione trovata.</p>';
}
document.querySelector("#refresh-assignment-matches").addEventListener("click",async()=>{
  const button=document.querySelector("#refresh-assignment-matches");
  button.disabled=true;button.textContent="Calcolo…";
  const {data,error}=await sb.rpc("admin_refresh_official_assignment_matches");
  button.disabled=false;button.textContent="Ricalcola abbinamenti";
  if(error)return alert(error.message);
  alert(`Abbinamenti: ${data.automatic} automatici, ${data.ambiguous} ambigui, ${data.unmatched} non trovati.`);
  await loadAssignments();
});
document.querySelector("#assignment-filters").addEventListener("submit",e=>{e.preventDefault();loadAssignments()});
document.querySelector("#assignment-list").addEventListener("click",async e=>{
  const row=e.target.closest(".assignment-row");if(!row)return;
  const id=Number(row.dataset.id);
  if(e.target.closest(".confirm-assignment")){
    if(!confirm("Confermare l’abbinamento e congelare le preferenze dell’utente?"))return;
    const {error}=await sb.rpc("admin_confirm_official_assignment",{p_assignment_id:id,p_candidate_id:null});
    if(error)return alert(error.message);await loadAssignments();return;
  }
  if(e.target.closest(".manual-assignment")){
    const candidate=prompt("ID del record da associare:");
    if(!candidate)return;
    const {error}=await sb.rpc("admin_confirm_official_assignment",{p_assignment_id:id,p_candidate_id:Number(candidate)});
    if(error)return alert(error.message);await loadAssignments();return;
  }
  if(e.target.closest(".unlink-assignment")){
    if(!confirm("Scollegare questa assegnazione e riaprire le preferenze se non esistono altri esiti confermati?"))return;
    const {error}=await sb.rpc("admin_unlink_official_assignment",{p_assignment_id:id});
    if(error)return alert(error.message);await loadAssignments();
  }
});
document.querySelector("#admin-google-login").addEventListener("click",()=>sb.auth.signInWithOAuth({provider:"google",options:{redirectTo:new URL("admin-assignments.html",location.href).href}}));
document.querySelector("#admin-otp-request-form").addEventListener("submit",async e=>{
  e.preventDefault();pendingEmail=document.querySelector("#admin-auth-email").value.trim();
  const {error}=await sb.auth.signInWithOtp({email:pendingEmail,options:{shouldCreateUser:false}});
  document.querySelector("#admin-login-message").textContent=error?error.message:"Codice inviato.";
  if(!error)document.querySelector("#admin-otp-verify-form").hidden=false;
});
document.querySelector("#admin-otp-verify-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const {error}=await sb.auth.verifyOtp({email:pendingEmail,token:document.querySelector("#admin-auth-otp").value.trim(),type:"email"});
  document.querySelector("#admin-login-message").textContent=error?error.message:"Accesso effettuato.";
});
logout.addEventListener("click",()=>sb.auth.signOut());
sb.auth.onAuthStateChange((_event,session)=>handleSession(session));
sb.auth.getSession().then(({data})=>handleSession(data.session));
