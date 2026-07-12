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
let selectedMunicipalitiesExpanded = false;

let map = null;
let mapReady = false;
let geojsonPromise = null;
let eligibilityIndex = new Map();
let schoolsByMunicipality = new Map();
let visibleResultsLimit = 20;
const RESULTS_PAGE_SIZE = 20;

function initMap() {
  if (mapReady) return;
  const mapElement = document.querySelector("#map");
  mapElement.innerHTML = "";
  map = L.map("map", { scrollWheelZoom: false }).setView([40.49, 16.08], 8);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  mapReady = true;
  drawMap();
}

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

async function loadSchoolsIndex() {
  try {
    if (window.SCHOOLS_INDEX && typeof window.SCHOOLS_INDEX === "object") {
      schoolsByMunicipality = new Map(Object.entries(window.SCHOOLS_INDEX));
      return;
    }

    const response = await fetch("./scuole-index.json?v=20260712", { cache: "force-cache" });
    if (!response.ok) throw new Error("Impossibile caricare l’elenco delle scuole.");
    const data = await response.json();
    schoolsByMunicipality = new Map(Object.entries(data));
  } catch (error) {
    console.error(error);
    schoolsByMunicipality = new Map();
  }
}

function schoolsForMunicipality(municipality, classCode) {
  const schools = schoolsByMunicipality.get(normalizeName(municipality)) || [];
  const wantedType = ["AAAA", "ADAA"].includes(classCode) ? "Infanzia" : "Primaria";
  return schools.filter(school => school.t === wantedType);
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

async function ensureGeoJSON() {
  if (geojsonData) return geojsonData;
  if (geojsonPromise) return geojsonPromise;

  geojsonPromise = fetch(GEOJSON_URL, { cache: "force-cache" })
    .then(response => {
      if (!response.ok) throw new Error("Impossibile caricare i comuni della Basilicata.");
      return response.json();
    })
    .then(data => {
      geojsonData = data;
      populateMunicipalityOptions();
      if (mapReady) drawMap();
      return geojsonData;
    })
    .catch(error => {
      geojsonPromise = null;
      throw error;
    });

  return geojsonPromise;
}

function buildEligibilityIndex() {
  eligibilityIndex = new Map();

  rows.forEach(row => {
    const municipalities = [...new Set((row.comuni || []).map(normalizeName))];

    (row.candidature || []).forEach(candidature => {
      const position = Number(candidature.posizione);
      if (!Number.isFinite(position)) return;

      municipalities.forEach(municipality => {
        const key = `${candidature.classe}|${municipality}`;
        if (!eligibilityIndex.has(key)) eligibilityIndex.set(key, []);
        eligibilityIndex.get(key).push(position);
      });
    });
  });

  eligibilityIndex.forEach(positions => positions.sort((a, b) => a - b));
}

function countPositionsBefore(sortedPositions, currentPosition) {
  let low = 0;
  let high = sortedPositions.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sortedPositions[middle] < currentPosition) low = middle + 1;
    else high = middle;
  }

  return low;
}

async function loadRows() {
  if (!supabaseClient) return;

  const body = document.querySelector("#results-body");
  if (body && !rows.length) {
    body.innerHTML = '<tr class="loading-row"><td colspan="4">Caricamento dei risultati…</td></tr>';
  }

  const { data, error } = await supabaseClient
    .from("candidati")
    .select("id,candidature,classe_concorso,posizione,punteggio,provincia_1,provincia_2,comuni,created_at")
    .order("created_at", { ascending: false });

  if (error) throw error;

  rows = (data || []).map(normalizeRow);
  buildEligibilityIndex();
  visibleResultsLimit = RESULTS_PAGE_SIZE;
  renderTable();

  if (mapReady && geojsonData) drawMap();
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
  const toggleButton = document.querySelector("#toggle-selected-municipalities");
  list.innerHTML = "";

  const visibleItems = selectedMunicipalitiesExpanded
    ? selectedMunicipalities
    : selectedMunicipalities.slice(0, 8);

  visibleItems.forEach((name, index) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="selected-position">${index + 1}</span><span>${escapeHtml(name)}</span>
      <button class="remove-municipality" type="button" data-index="${index}" aria-label="Rimuovi ${escapeHtml(name)}">×</button>`;
    list.appendChild(li);
  });

  const hasHiddenItems = selectedMunicipalities.length > 8;
  toggleButton.hidden = !hasHiddenItems;
  toggleButton.textContent = selectedMunicipalitiesExpanded
    ? "Mostra meno"
    : `Mostra altre ${selectedMunicipalities.length - 8}`;

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
  if (!geojsonData || !mapReady || !map) return;
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


function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function eligibilityLabel(value) {
  if (value >= 75) return "Alta";
  if (value >= 50) return "Media";
  if (value >= 25) return "Bassa";
  return "Molto bassa";
}

function calculateEligibility(row, candidature, municipality, preferenceIndex) {
  const currentPosition = Number(candidature.posizione);
  if (!Number.isFinite(currentPosition)) return null;

  const key = `${candidature.classe}|${normalizeName(municipality)}`;
  const positions = eligibilityIndex.get(key) || [];
  const betterRanked = countPositionsBefore(positions, currentPosition);
  const sameMunicipalityTotal = positions.length;

  const preferencePenalty = preferenceIndex * 2.25;
  const competitionPenalty = betterRanked * 8;
  const crowdPenalty = Math.max(
    0,
    sameMunicipalityTotal - betterRanked - 1
  ) * 1.25;

  return Math.round(
    clamp(95 - preferencePenalty - competitionPenalty - crowdPenalty, 5, 95)
  );
}

function renderEligibilityBar(value, classCode) {
  const label = eligibilityLabel(value);

  return `
    <div class="eligibility" title="Stima orientativa basata sui dati inseriti dagli utenti">
      <div class="eligibility-head">
        <span>${classCode}</span>
        <strong>${value}%</strong>
      </div>
      <div class="eligibility-track" aria-hidden="true">
        <span class="eligibility-fill ${classCode}" style="width:${value}%"></span>
      </div>
      <small>Eleggibilità ${label.toLowerCase()}</small>
    </div>
  `;
}

function renderMunicipalitiesWithEligibility(row, selectedClass) {
  const candidatures = getRelevantCandidatures(row, selectedClass);

  return `
    <div class="municipality-preferences">
      ${(row.comuni || []).map((municipality, index) => {
        const schoolGroups = candidatures.map(candidature => {
          const value = calculateEligibility(row, candidature, municipality, index);
          const matchingSchools = schoolsForMunicipality(municipality, candidature.classe);

          if (!matchingSchools.length) {
            return `
              <div class="school-eligibility-item school-eligibility-item--fallback">
                <div class="school-name-row">
                  <span class="class-chip ${candidature.classe}">${candidature.classe}</span>
                  <div>
                    <strong>${escapeHtml(municipality)}</strong>
                    <small>Stima riferita al comune</small>
                  </div>
                </div>
                ${renderEligibilityBar(value, candidature.classe)}
              </div>
            `;
          }

          return matchingSchools.map(school => `
            <div class="school-eligibility-item">
              <div class="school-name-row">
                <span class="class-chip ${candidature.classe}">${candidature.classe}</span>
                <div>
                  <strong>${escapeHtml(school.n)} – ${escapeHtml(municipality)}</strong>
                  <small>${escapeHtml(school.i)}</small>
                </div>
              </div>
              ${renderEligibilityBar(value, candidature.classe)}
            </div>
          `).join("");
        }).join("");

        return `
          <div class="municipality-preference-item">
            <div class="municipality-name">
              <span class="preference-number">${index + 1}</span>
              <strong>${escapeHtml(municipality)}</strong>
            </div>
            <div class="eligibility-list">${schoolGroups}</div>
          </div>
        `;
      }).join("")}
    </div>
  `;
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
  const visibleData = data.slice(0, visibleResultsLimit);
  const loadMoreButton = document.querySelector("#load-more-results");

  body.innerHTML = "";

  if (!data.length) {
    body.innerHTML = '<tr><td colspan="4">Nessun dato corrispondente ai filtri.</td></tr>';
  } else {
    const fragment = document.createDocumentFragment();

    visibleData.forEach(row => {
      const visibleCandidatures = getRelevantCandidatures(row, selectedClass);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${renderCandidaturesSummary(visibleCandidatures)}</td>
        <td>${escapeHtml(row.provincia_1)}</td>
        <td>${escapeHtml(row.provincia_2 || "—")}</td>
        <td class="municipalities-cell">${renderMunicipalitiesWithEligibility(row, selectedClass)}</td>
      `;
      fragment.appendChild(tr);
    });

    body.appendChild(fragment);
  }

  document.querySelector("#results-count").textContent =
    `${Math.min(visibleData.length, data.length)} risultati mostrati su ${data.length} (${rows.length} compilazioni totali).`;

  if (loadMoreButton) {
    const hasMoreResults = visibleData.length < data.length;
    loadMoreButton.hidden = !hasMoreResults;
    loadMoreButton.disabled = !hasMoreResults;
    loadMoreButton.textContent = hasMoreResults
      ? `Mostra altri risultati (${data.length - visibleData.length} rimanenti)`
      : "Tutti i risultati sono visibili";
  }
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
  el.addEventListener("change", async () => {
    const p1 = document.querySelector("#provincia_1").value;
    const p2 = document.querySelector("#provincia_2").value;

    if (p1 && p2 && p1 === p2) {
      document.querySelector("#provincia_2").value = "";
    }

    const select = document.querySelector("#municipality-select");
    if ((p1 || p2) && !geojsonData) {
      select.disabled = true;
      select.innerHTML = '<option value="">Caricamento comuni…</option>';
      try {
        await ensureGeoJSON();
      } catch (error) {
        select.innerHTML = '<option value="">Errore nel caricamento dei comuni</option>';
        showMessage(error.message, true);
        return;
      }
    }

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


document.querySelector("#toggle-selected-municipalities").addEventListener("click", () => {
  selectedMunicipalitiesExpanded = !selectedMunicipalitiesExpanded;
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
  selectedMunicipalitiesExpanded = false;
  document.querySelector("#candidatures-list").innerHTML = "";
  addCandidatureRow();
  renderSelectedMunicipalities();
  showMessage("Dati inviati correttamente. Grazie!");
  await loadRows();
});

document.querySelector("#map-filter").addEventListener("change", drawMap);
document.querySelector("#table-class-filter").addEventListener("change", () => {
  visibleResultsLimit = RESULTS_PAGE_SIZE;
  renderTable();
});
document.querySelector("#municipality-search").addEventListener("input", () => {
  visibleResultsLimit = RESULTS_PAGE_SIZE;
  renderTable();
});
document.querySelector("#position-sort").addEventListener("change", () => {
  visibleResultsLimit = RESULTS_PAGE_SIZE;
  renderTable();
});
const loadMoreResultsButton = document.querySelector("#load-more-results");
if (loadMoreResultsButton) {
  loadMoreResultsButton.addEventListener("click", () => {
    visibleResultsLimit += RESULTS_PAGE_SIZE;
    renderTable();
  });
}

document.querySelector("#download-csv").addEventListener("click", downloadCsv);
document.querySelector("#refresh-data").addEventListener("click", async () => {
  try { await loadRows(); } catch (error) { showMessage(error.message, true); }
});


function observeMap() {
  const mapElement = document.querySelector("#map");
  if (!mapElement) return;

  const startMap = async () => {
    mapElement.innerHTML = '<div class="map-loading">Caricamento della mappa…</div>';
    try {
      await ensureGeoJSON();
      initMap();
    } catch (error) {
      mapElement.innerHTML = '<div class="map-loading">Mappa momentaneamente non disponibile.</div>';
      console.error(error);
    }
  };

  if (!("IntersectionObserver" in window)) {
    startMap();
    return;
  }

  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      startMap();
      observer.disconnect();
    }
  }, { rootMargin: "180px 0px" });

  observer.observe(mapElement);
}



(async function start() {
  try {
    addCandidatureRow();
    initSupabase();
    observeMap();
    await loadSchoolsIndex();
    if (supabaseClient) await loadRows();
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Errore durante l’avvio dell’applicazione.", true);
  }
})();