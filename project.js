if(!window.supabase||!window.APP_CONFIG?.SUPABASE_URL||!window.APP_CONFIG?.SUPABASE_KEY){
  document.querySelector("#project-dashboard-updated").textContent="Dati non disponibili";
  throw new Error("Configurazione Supabase mancante");
}

const sb=window.supabase.createClient(
  window.APP_CONFIG.SUPABASE_URL,
  window.APP_CONFIG.SUPABASE_KEY
);

function formatNumber(value){
  return new Intl.NumberFormat("it-IT").format(Number(value||0));
}

function renderBars(rootId,data,order){
  const root=document.querySelector(rootId);
  const values=order.map(key=>({key,value:Number(data?.[key]||0)}));
  const max=Math.max(...values.map(item=>item.value),1);

  root.innerHTML=values.map(item=>`
    <div class="project-bar">
      <div class="project-bar__head">
        <strong>${item.key}</strong>
        <span>${formatNumber(item.value)}</span>
      </div>
      <div class="project-bar__track">
        <span style="width:${Math.max(2,(item.value/max)*100)}%"></span>
      </div>
    </div>`).join("");
}

async function loadDashboard(){
  const {data,error}=await sb.rpc("get_public_project_dashboard");
  if(error)throw error;

  const metrics=[
    ["Compilazioni",data.candidate_count],
    ["Account registrati",data.registered_user_count],
    ["Preferenze scolastiche",data.preference_count],
    ["Assegnazioni ufficiali",data.assignment_count],
    ["Scuole assegnate",data.assigned_school_count],
    ["Esiti abbinati",data.confirmed_assignment_count]
  ];

  document.querySelector("#project-metrics").innerHTML=metrics.map(([label,value])=>`
    <article class="project-metric">
      <span>${label}</span>
      <strong>${formatNumber(value)}</strong>
    </article>`).join("");

  renderBars("#project-class-bars",data.class_counts,["AAAA","ADAA","EEEE","ADEE"]);
  renderBars("#project-province-bars",data.province_counts,["Matera","Potenza"]);

  document.querySelector("#project-dashboard-updated").textContent=
    `Aggiornato ${new Date(data.updated_at).toLocaleString("it-IT",{
      dateStyle:"short",timeStyle:"short"
    })}`;
}

loadDashboard().catch(error=>{
  console.error(error);
  document.querySelector("#project-dashboard-updated").textContent="Dati non disponibili";
});
