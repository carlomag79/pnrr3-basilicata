const GEOJSON_URL="https://raw.githubusercontent.com/openpolis/geojson-italy/master/geojson/limits_R_17_municipalities.geojson";
const PAGE_SIZE=40;
let assignments=[];
let filteredAssignments=[];
let visibleLimit=PAGE_SIZE;
let schools=[];
let municipalityCentroids=new Map();
let map=null;
let markerLayer=null;

const sb=window.supabase.createClient(
  window.APP_CONFIG.SUPABASE_URL,
  window.APP_CONFIG.SUPABASE_KEY
);

const esc=value=>String(value??"")
  .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
  .replaceAll('"',"&quot;").replaceAll("'","&#039;");

function normalize(value){
  return String(value||"").trim().toLocaleLowerCase("it-IT")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"");
}

function getFeatureName(feature){
  const p=feature.properties||{};
  return p.com_name||p.name||p.COMUNE||p.denominazione||p.nome||p.NAME_3||"";
}

function polygonCenter(feature){
  try{
    const layer=L.geoJSON(feature);
    const center=layer.getBounds().getCenter();
    return [center.lat,center.lng];
  }catch(_){return null}
}

function deterministicOffset(code){
  let hash=0;
  for(const char of String(code||""))hash=((hash<<5)-hash+char.charCodeAt(0))|0;
  const angle=Math.abs(hash%360)*Math.PI/180;
  const radius=.003+(Math.abs(hash>>8)%6)*.0007;
  return [Math.cos(angle)*radius,Math.sin(angle)*radius];
}

function schoolForAssignment(item){
  return schools.find(s=>s.codice===item.codice_scuola)
    ||schools.find(s=>s.codice_istituto===item.codice_scuola)
    ||null;
}

function inferMunicipality(item,school){
  if(school?.comune)return school.comune;
  const text=item.denominazione_scuola||"";
  const known=[...municipalityCentroids.keys()].sort((a,b)=>b.length-a.length);
  return known.find(name=>normalize(text).includes(normalize(name)))||null;
}

function coordinatesForAssignment(item){
  const school=schoolForAssignment(item);
  const municipality=inferMunicipality(item,school);
  const center=municipalityCentroids.get(normalize(municipality));
  if(!center)return null;
  const offset=deterministicOffset(item.codice_scuola);
  return [center[0]+offset[0],center[1]+offset[1]];
}

function aggregateSchools(rows){
  const groups=new Map();
  rows.forEach(item=>{
    const key=item.codice_scuola;
    if(!groups.has(key)){
      groups.set(key,{
        codice_scuola:key,
        denominazione_scuola:item.denominazione_scuola,
        provincia_assegnata:item.provincia_assegnata,
        totale:0,
        classi:{}
      });
    }
    const group=groups.get(key);
    group.totale++;
    group.classi[item.insegnamento]=(group.classi[item.insegnamento]||0)+1;
  });
  return [...groups.values()];
}

function markerStyle(total){
  if(total>=5)return {radius:15,fillColor:"#8b2e2e",color:"#641f1f"};
  if(total>=2)return {radius:11,fillColor:"#d07a35",color:"#98531f"};
  return {radius:8,fillColor:"#4d738a",color:"#36576a"};
}

function renderMap(){
  if(!map)return;
  if(markerLayer)markerLayer.clearLayers();

  markerLayer=L.layerGroup().addTo(map);
  const groups=aggregateSchools(filteredAssignments);
  const bounds=[];

  groups.forEach(group=>{
    const coords=coordinatesForAssignment(group);
    if(!coords)return;
    bounds.push(coords);
    const style=markerStyle(group.totale);
    const classes=Object.entries(group.classi)
      .map(([code,count])=>`<span class="class-chip ${code}">${code}: ${count}</span>`)
      .join(" ");
    L.circleMarker(coords,{
      radius:style.radius,
      color:style.color,
      weight:2,
      fillColor:style.fillColor,
      fillOpacity:.84
    }).bindPopup(`
      <div class="assignment-popup">
        <h3>${esc(group.denominazione_scuola)}</h3>
        <p><strong>Codice:</strong> ${esc(group.codice_scuola)}</p>
        <p><strong>Provincia:</strong> ${esc(group.provincia_assegnata)}</p>
        <p><strong>Assegnazioni:</strong> ${group.totale}</p>
        <div class="assignment-popup__classes">${classes}</div>
      </div>
    `).addTo(markerLayer);
  });

  if(bounds.length)map.fitBounds(bounds,{padding:[28,28],maxZoom:12});
}

function renderStats(){
  const classes=assignments.reduce((acc,item)=>(acc[item.insegnamento]=(acc[item.insegnamento]||0)+1,acc),{});
  const schoolsCount=new Set(assignments.map(item=>item.codice_scuola)).size;
  document.querySelector("#assignments-stats").innerHTML=`
    <span class="badge">${assignments.length} assegnazioni</span>
    <span class="badge">${schoolsCount} scuole</span>
    <span class="badge">AAAA ${classes.AAAA||0}</span>
    <span class="badge">ADAA ${classes.ADAA||0}</span>
    <span class="badge">EEEE ${classes.EEEE||0}</span>
    <span class="badge">ADEE ${classes.ADEE||0}</span>`;
}

function applyFilters(){
  const classe=document.querySelector("#assignments-class").value;
  const province=document.querySelector("#assignments-province").value;
  const query=normalize(document.querySelector("#assignments-search").value);

  filteredAssignments=assignments.filter(item=>{
    const hay=normalize(`${item.codice_scuola} ${item.denominazione_scuola}`);
    return (classe==="ALL"||item.insegnamento===classe)
      &&(province==="ALL"||item.provincia_assegnata===province)
      &&(!query||hay.includes(query));
  });

  visibleLimit=PAGE_SIZE;
  renderTable();
  renderMap();
}

function renderTable(){
  const visible=filteredAssignments.slice(0,visibleLimit);
  const body=document.querySelector("#assignments-body");

  body.innerHTML=visible.length?visible.map(item=>`
    <tr>
      <td><span class="class-chip ${esc(item.insegnamento)}">${esc(item.insegnamento)}</span></td>
      <td>${esc(item.graduatoria)}</td>
      <td>${item.posizione}</td>
      <td>${Number(item.punteggio).toFixed(2)}</td>
      <td>${esc(item.esito)}</td>
      <td>${esc(item.provincia_assegnata)}</td>
      <td><strong>${esc(item.denominazione_scuola)}</strong><br><small>${esc(item.codice_scuola)}</small></td>
      <td>${item.nomina_coe?"Sì":"No"}</td>
    </tr>`).join("")
    :'<tr><td colspan="8">Nessuna assegnazione corrisponde ai filtri.</td></tr>';

  document.querySelector("#assignments-count").textContent=
    `${visible.length} di ${filteredAssignments.length} assegnazioni`;

  const more=document.querySelector("#assignments-load-more");
  more.hidden=visible.length>=filteredAssignments.length;
  more.textContent=`Mostra altri risultati (${filteredAssignments.length-visible.length})`;
}

function downloadCsv(){
  const headers=["insegnamento","graduatoria","posizione","punteggio","esito","provincia_assegnata","codice_scuola","denominazione_scuola","nomina_coe"];
  const quote=value=>`"${String(value??"").replaceAll('"','""')}"`;
  const rows=[headers.join(","),...filteredAssignments.map(item=>headers.map(key=>quote(item[key])).join(","))];
  const blob=new Blob(["\ufeff"+rows.join("\n")],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download="assegnazioni-pnrr3-basilicata.csv";a.click();
  URL.revokeObjectURL(url);
}

async function init(){
  const [{data,error},schoolsResponse,geoResponse]=await Promise.all([
    sb.rpc("get_public_official_assignments"),
    fetch("scuole.json",{cache:"force-cache"}),
    fetch(GEOJSON_URL,{cache:"force-cache"})
  ]);
  if(error)throw error;
  if(!schoolsResponse.ok)throw new Error("Impossibile caricare i dati delle scuole.");
  if(!geoResponse.ok)throw new Error("Impossibile caricare la mappa.");

  assignments=data||[];
  schools=await schoolsResponse.json();
  const geojson=await geoResponse.json();

  geojson.features.forEach(feature=>{
    const name=getFeatureName(feature);
    const center=polygonCenter(feature);
    if(name&&center)municipalityCentroids.set(normalize(name),center);
  });

  map=L.map("assignments-map",{scrollWheelZoom:false}).setView([40.49,16.08],8);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
    maxZoom:19,
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  L.geoJSON(geojson,{style:{color:"#b8c4c9",weight:1,fillColor:"#eef2f3",fillOpacity:.22}}).addTo(map);

  renderStats();
  filteredAssignments=[...assignments];
  renderTable();
  renderMap();
}

["#assignments-class","#assignments-province"].forEach(selector=>
  document.querySelector(selector).addEventListener("change",applyFilters)
);
document.querySelector("#assignments-search").addEventListener("input",applyFilters);
document.querySelector("#assignments-load-more").addEventListener("click",()=>{
  visibleLimit+=PAGE_SIZE;renderTable();
});
document.querySelector("#assignments-download").addEventListener("click",downloadCsv);

init().catch(error=>{
  console.error(error);
  document.querySelector("#assignments-body").innerHTML=`<tr><td colspan="8">${esc(error.message)}</td></tr>`;
  document.querySelector("#assignments-map").innerHTML='<div class="map-loading">Mappa momentaneamente non disponibile.</div>';
});
