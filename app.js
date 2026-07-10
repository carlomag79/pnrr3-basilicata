const CONFIG = window.APP_CONFIG || {};
const GEOJSON_URL = "https://raw.githubusercontent.com/openpolis/geojson-italy/master/geojson/limits_R_17_municipalities.geojson";

const CLASS_COLORS = {
  AAAA: "#d97706",
  ADAA: "#7c3aed",
  EEEE: "#0f766e",
  ADEE: "#2563eb"
};

const CLASS_LABELS = {
  AAAA: "AAAA – Infanzia, posto comune",
  ADAA: "ADAA – Infanzia, sostegno",
  EEEE: "EEEE – Primaria, posto comune",
  ADEE: "ADEE – Primaria, sostegno"
};

let supabaseClient = null;
let geojsonData = null;
let rows = [];
let selectedMunicipalities = [];
let municipalityLayer = null;

const map = L.map("map", { scrollWheelZoom: false }).setView([40.49, 16.08], 8);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

function getFeatureName(feature) {
  const p = feature.properties || {};
  return p.com_name || p.name || p.COMUNE || p.denominazione || p.nome || p.NAME_3 || "";
}

function getFeatureProvince(feature) {
  const p = feature.properties || {};
  const raw = String(
    p.prov_name || p.province_name || p.provincia || p.PROVINCIA ||
    p.prov_acr || p.sigla || p.cod_prov || p.prov_istat_code_num || ""
  ).toLowerCase();

  if (raw.includes("potenza") || raw === "pz" || raw === "76" || raw === "076") return "Potenza";
  if (raw.includes("matera") || raw === "mt" || raw === "77" || raw === "077") return "Matera";

  const code = String(p.pro_com || p.com_istat_code_num || "");
  if (code.startsWith("076")) return "Potenza";
  if (code.startsWith("077")) return "Matera";
  return "";
}

function normalizeName(value) {
  return String(value || "").trim().toLocaleLowerCase("it-IT");
}

function normalizeRow(row) {
  if (Array.isArray(row.candidature) && row.candidature.length) return row;
  if (row.classe_concorso) {
    return {
      ...row,
      candidature: [{
        classe: row.classe_concorso,
        posizione: row.posizione,
        punteggio: row.punteggio
      }]
    };
  }
  return { ...row, candidature: [] };
}

function initSupabase() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY ||
      CONFIG.SUPABASE_URL.includes("INCOLLA_QUI") ||
      CONFIG.SUPABASE_KEY.includes("INCOLLA_QUI")) {
    showMessage("Configura prima URL e Publishable Key nel file config.js.", true);
    return false;
  }
  supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
  return true;
}

async function loadGeoJSON() {
  const response = await fetch(GEOJSON_URL);
  if (!response.ok) throw new Error("Impossibile caricare i confini comunali.");
  geojsonData = await response.json();
  populateMunicipalityOptions();
  drawMap();
}

async function loadRows() {
  if (!supabaseClient) return;
  const { data, error } = await supabaseClient
    .from("candidati")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  rows = (data || []).map(normalizeRow);
  renderTable();
  drawMap();
}

function candidatureOptions(selected = "") {
  return `
    <option value="">Seleziona</option>
    ${Object.entries(CLASS_LABELS).map(([value, label]) =>
      `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`
    ).join("")}
  `;
}

function addCandidatureRow(values = {}) {
  const list = document.querySelector("#candidatures-list");
  const row = document.createElement("div");
  row.className = "candidature-row";
  row.innerHTML = `
    <label>
      Classe di concorso
      <select class="candidature-class" required>${candidatureOptions(values.classe || "")}</select>
    </label>
    <label>
      Posizione
      <input class="candidature-position" type="number" min="1" step="1" value="${values.posizione || ""}" required>
    </label>
    <label>
      Punteggio
      <input class="candidature-score" type="number" min="0" step="0.01" value="${values.punteggio || ""}" required>
    </label>
    <button type="button" class="remove-candidature">Rimuovi</button>
  `;
  list.appendChild(row);
  updateCandidatureControls();
}

function updateCandidatureControls() {
  const rowsEls = [...document.querySelectorAll(".candidature-row")];
  rowsEls.forEach(row => {
    row.querySelector(".remove-candidature").disabled = rowsEls.length === 1;
  });
}

function getCandidatures() {
  const result = [...document.querySelectorAll(".candidature-row")].map(row => ({
    classe: row.querySelector(".candidature-class").value,
    posizione: Number(row.querySelector(".candidature-position").value),
    punteggio: Number(row.querySelector(".candidature-score").value)
  }));

  if (!result.length) throw new Error("Inserisci almeno una classe di concorso.");
  if (result.some(item => !item.classe || !item.posizione || Number.isNaN(item.punteggio))) {
    throw new Error("Completa classe, posizione e punteggio per ogni candidatura.");
  }

  const classes = result.map(item => item.classe);
  if (new Set(classes).size !== classes.length) {
    throw new Error("La stessa classe di concorso non può essere inserita due volte.");
  }
  return result;
}

function selectedProvinces() {
  return [
    document.querySelector("#provincia_1").value,
    document.querySelector("#provincia_2").value
  ].filter(Boolean);
}

function populateMunicipalityOptions() {
  const select = document.querySelector("#municipality-select");
  if (!geojsonData) return;

  const provinces = selectedProvinces();
  const names = geojsonData.features
    .map(feature => ({ name: getFeatureName(feature), province: getFeatureProvince(feature) }))
    .filter(item => item.name && (!provinces.length || provinces.includes(item.province)))
    .filter(item => !selectedMunicipalities.includes(item.name))
    .sort((a, b) => a.name.localeCompare(b.name, "it"));

  select.innerHTML = provinces.length
    ? '<option value="">Seleziona un comune</option>'
    : '<option value="">Seleziona prima almeno una provincia</option>';

  names.forEach(item => {
    const option = document.createElement("option");
    option.value = item.name;
    option.textContent = `${item.name}${item.province ? ` (${item.province})` : ""}`;
    select.appendChild(option);
  });

  select.disabled = provinces.length === 0 || selectedMunicipalities.length >= 20;
}

function renderSelectedMunicipalities() {
  const list = document.querySelector("#selected-municipalities");
  list.innerHTML = "";

  selectedMunicipalities.forEach((name, index) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${index + 1}.</strong> ${escapeHtml(name)}
      <button class="remove-municipality" type="button" data-index="${index}" aria-label="Rimuovi ${escapeHtml(name)}">Rimuovi</button>`;
    list.appendChild(li);
  });

  document.querySelector("#counter").textContent = `${selectedMunicipalities.length} / 20`;
  populateMunicipalityOptions();
}

function rowHasClass(row, classCode) {
  return (row.candidature || []).some(item => item.classe === classCode);
}

function buildCounts(filterClass = "ALL") {
  const counts = {};
  rows.forEach(row => {
    const classes = (row.candidature || [])
      .map(item => item.classe)
      .filter(cls => filterClass === "ALL" || cls === filterClass);

    if (!classes.length) return;

    (row.comuni || []).forEach(name => {
      const key = normalizeName(name);
      if (!counts[key]) counts[key] = { total: 0, AAAA: 0, ADAA: 0, EEEE: 0, ADEE: 0 };
      counts[key].total += 1;
      classes.forEach(cls => {
        counts[key][cls] = (counts[key][cls] || 0) + 1;
      });
    });
  });
  return counts;
}

function dominantClass(count) {
  return ["AAAA", "ADAA", "EEEE", "ADEE"]
    .sort((a, b) => (count[b] || 0) - (count[a] || 0))[0];
}

function drawMap() {
  if (!geojsonData) return;
  if (municipalityLayer) municipalityLayer.remove();

  const filter = document.querySelector("#map-filter").value;
  const counts = buildCounts(filter);

  municipalityLayer = L.geoJSON(geojsonData, {
    style: feature => {
      const count = counts[normalizeName(getFeatureName(feature))];
      if (!count) return { color: "#9aa8af", weight: 1, fillColor: "#dfe6e9", fillOpacity: 0.28 };
      const cls = filter === "ALL" ? dominantClass(count) : filter;
      return {
        color: "#ffffff",
        weight: 1.2,
        fillColor: CLASS_COLORS[cls],
        fillOpacity: Math.min(0.32 + count.total * 0.07, 0.9)
      };
    },
    onEachFeature: (feature, layer) => {
      const name = getFeatureName(feature);
      const count = counts[normalizeName(name)] || { total: 0, AAAA: 0, ADAA: 0, EEEE: 0, ADEE: 0 };
      layer.bindPopup(`
        <strong>${escapeHtml(name)}</strong><br>
        Utenti che lo hanno scelto: <strong>${count.total}</strong><br><br>
        AAAA: ${count.AAAA}<br>
        ADAA: ${count.ADAA}<br>
        EEEE: ${count.EEEE}<br>
        ADEE: ${count.ADEE}
      `);
      layer.on({
        mouseover: e => e.target.setStyle({ weight: 2.4 }),
        mouseout: e => municipalityLayer.resetStyle(e.target)
      });
    }
  }).addTo(map);

  try { map.fitBounds(municipalityLayer.getBounds(), { padding: [12, 12] }); } catch (_) {}
}

function getRelevantCandidatures(row, selectedClass) {
  const candidatures = row.candidature || [];
  return selectedClass === "ALL"
    ? candidatures
    : candidatures.filter(item => item.classe === selectedClass);
}

function getRowPositionForSort(row, selectedClass, direction) {
  const relevant = getRelevantCandidatures(row, selectedClass);
  const positions = relevant
    .map(item => Number(item.posizione))
    .filter(value => Number.isFinite(value));

  if (!positions.length) return Number.POSITIVE_INFINITY;

  return direction === "desc"
    ? Math.max(...positions)
    : Math.min(...positions);
}

function filteredRows() {
  const cls = document.querySelector("#table-class-filter").value;
  const query = normalizeName(document.querySelector("#municipality-search").value);
  const sortDirection = document.querySelector("#position-sort").value;

  const filtered = rows.filter(row => {
    const classOk = cls === "ALL" || getRelevantCandidatures(row, cls).length > 0;
    const municipalityOk = !query || (row.comuni || []).some(name =>
      normalizeName(name).includes(query)
    );
    return classOk && municipalityOk;
  });

  if (sortDirection === "asc" || sortDirection === "desc") {
    filtered.sort((a, b) => {
      const positionA = getRowPositionForSort(a, cls, sortDirection);
      const positionB = getRowPositionForSort(b, cls, sortDirection);

      return sortDirection === "asc"
        ? positionA - positionB
        : positionB - positionA;
    });
  }

  return filtered;
}

function renderCandidaturesSummary(candidatures) {
  return `<div class="candidature-summary">${
    candidatures.map(item => `
      <div class="candidature-summary-item">
        <span class="class-chip ${item.classe}">${item.classe}</span>
        <span>Pos. <strong>${item.posizione}</strong> · Punti <strong>${Number(item.punteggio).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
      </div>
    `).join("")
  }</div>`;
}

function renderTable() {
  const body = document.querySelector("#results-body");
  const data = filteredRows();
  const selectedClass = document.querySelector("#table-class-filter").value;
  body.innerHTML = "";

  if (!data.length) {
    body.innerHTML = '<tr><td colspan="4">Nessun dato corrispondente ai filtri.</td></tr>';
  } else {
    data.forEach(row => {
      const visibleCandidatures = getRelevantCandidatures(row, selectedClass);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${renderCandidaturesSummary(visibleCandidatures)}</td>
        <td>${escapeHtml(row.provincia_1)}</td>
        <td>${escapeHtml(row.provincia_2 || "—")}</td>
        <td class="municipalities-cell">${(row.comuni || []).map((name, i) => `${i + 1}. ${escapeHtml(name)}`).join(" · ")}</td>
      `;
      body.appendChild(tr);
    });
  }

  document.querySelector("#results-count").textContent = `${data.length} compilazioni visualizzate su ${rows.length}.`;
}

function downloadCsv() {
  const data = filteredRows();
  const selectedClass = document.querySelector("#table-class-filter").value;
  const header = ["classi_posizioni_punteggi", "provincia_1", "provincia_2", "comuni"];
  const lines = [
    header.join(";"),
    ...data.map(row => [
      getRelevantCandidatures(row, selectedClass)
        .map(item => `${item.classe}: posizione ${item.posizione}, punteggio ${item.punteggio}`)
        .join(" | "),
      row.provincia_1,
      row.provincia_2 || "",
      (row.comuni || []).join(" | ")
    ].map(csvCell).join(";"))
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pnrr3-basilicata-risultati.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showMessage(message, isError = false) {
  const el = document.querySelector("#form-message");
  el.textContent = message;
  el.className = isError ? "error" : "success";
}

document.querySelector("#add-candidature").addEventListener("click", () => addCandidatureRow());

document.querySelector("#candidatures-list").addEventListener("click", event => {
  const button = event.target.closest(".remove-candidature");
  if (!button) return;
  button.closest(".candidature-row").remove();
  updateCandidatureControls();
});

document.querySelectorAll("#provincia_1, #provincia_2").forEach(el => {
  el.addEventListener("change", () => {
    const p1 = document.querySelector("#provincia_1").value;
    const p2 = document.querySelector("#provincia_2").value;
    if (p1 && p2 && p1 === p2) document.querySelector("#provincia_2").value = "";
    populateMunicipalityOptions();
  });
});

document.querySelector("#add-municipality").addEventListener("click", () => {
  const select = document.querySelector("#municipality-select");
  if (!select.value || selectedMunicipalities.length >= 20) return;
  selectedMunicipalities.push(select.value);
  renderSelectedMunicipalities();
});

document.querySelector("#selected-municipalities").addEventListener("click", event => {
  const button = event.target.closest("[data-index]");
  if (!button) return;
  selectedMunicipalities.splice(Number(button.dataset.index), 1);
  renderSelectedMunicipalities();
});

document.querySelector("#candidate-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!supabaseClient) return showMessage("Supabase non è ancora configurato.", true);
  if (!selectedMunicipalities.length) return showMessage("Inserisci almeno un comune.", true);

  let candidature;
  try {
    candidature = getCandidatures();
  } catch (error) {
    return showMessage(error.message, true);
  }

  const submitButton = event.submitter;
  submitButton.disabled = true;
  showMessage("Invio in corso…");

  const payload = {
    candidature,
    provincia_1: document.querySelector("#provincia_1").value,
    provincia_2: document.querySelector("#provincia_2").value || null,
    comuni: selectedMunicipalities
  };

  const { error } = await supabaseClient.from("candidati").insert(payload);

  submitButton.disabled = false;
  if (error) return showMessage(`Invio non riuscito: ${error.message}`, true);

  event.target.reset();
  selectedMunicipalities = [];
  document.querySelector("#candidatures-list").innerHTML = "";
  addCandidatureRow();
  renderSelectedMunicipalities();
  showMessage("Dati inviati correttamente. Grazie!");
  await loadRows();
});

document.querySelector("#map-filter").addEventListener("change", drawMap);
document.querySelector("#table-class-filter").addEventListener("change", renderTable);
document.querySelector("#municipality-search").addEventListener("input", renderTable);
document.querySelector("#position-sort").addEventListener("change", renderTable);
document.querySelector("#download-csv").addEventListener("click", downloadCsv);
document.querySelector("#refresh-data").addEventListener("click", async () => {
  try { await loadRows(); } catch (error) { showMessage(error.message, true); }
});

(async function start() {
  try {
    addCandidatureRow();
    initSupabase();
    await loadGeoJSON();
    if (supabaseClient) await loadRows();
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Errore durante l’avvio dell’applicazione.", true);
  }
})();