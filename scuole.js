const GEOJSON_URL = "https://raw.githubusercontent.com/openpolis/geojson-italy/master/geojson/limits_R_17_municipalities.geojson";
const MATERA = [40.6663, 16.6043];
const POTENZA = [40.6404, 15.8056];
const PAGE_SIZE = 40;

let schools = [];
let filteredSchools = [];
let visibleLimit = PAGE_SIZE;
let map = null;
let municipalityCentroids = new Map();
let markers = new Map();
let activeCode = null;

function normalize(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("it-IT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getFeatureName(feature) {
  const p = feature.properties || {};
  return p.com_name || p.name || p.COMUNE || p.denominazione || p.nome || p.NAME_3 || "";
}

function polygonCenter(feature) {
  try {
    const layer = L.geoJSON(feature);
    const center = layer.getBounds().getCenter();
    return [center.lat, center.lng];
  } catch (_) {
    return null;
  }
}

function deterministicOffset(code) {
  let hash = 0;
  for (const char of code) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  const angle = Math.abs(hash % 360) * Math.PI / 180;
  const radius = 0.003 + (Math.abs(hash >> 8) % 6) * 0.0007;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

function haversineKm([lat1, lon1], [lat2, lon2]) {
  const toRad = value => value * Math.PI / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatAvailability(school) {
  return ["AAAA", "ADAA", "EEEE", "ADEE"].map(code => {
    const value = school.disponibilita?.[code];
    return `<span><strong>${code}</strong><br>${value == null ? "—" : value}</span>`;
  }).join("");
}

function popupHtml(school, coordinates, approximate = false) {
  const materaDistance = coordinates ? haversineKm(coordinates, MATERA).toFixed(1) : "—";
  const potenzaDistance = coordinates ? haversineKm(coordinates, POTENZA).toFixed(1) : "—";
  const address = [school.indirizzo, school.cap, school.comune].filter(Boolean).join(", ");
  const osmQuery = encodeURIComponent(`${school.denominazione}, ${address}, Basilicata, Italia`);

  return `
    <div class="school-popup">
      <h3>${escapeHtml(school.denominazione)}</h3>
      <p><strong>Tipologia:</strong> ${escapeHtml(school.tipo)}</p>
      <p><strong>Sede:</strong> ${escapeHtml(address || school.comune)}</p>
      <p><strong>Istituto:</strong> ${escapeHtml(school.istituto)}</p>
      <p><strong>Codice:</strong> ${escapeHtml(school.codice)}</p>
      ${approximate ? '<p><em>Posizione cartografica approssimativa.</em></p>' : ""}
      <div class="school-popup__availability">${formatAvailability(school)}</div>
      <div class="school-popup__distances">
        <p><strong>Distanza in linea d’aria:</strong></p>
        <p>Matera: ${materaDistance} km · Potenza: ${potenzaDistance} km</p>
      </div>
      <a class="school-popup__link" href="https://www.openstreetmap.org/search?query=${osmQuery}" target="_blank" rel="noopener noreferrer">Apri la ricerca su OpenStreetMap</a>
    </div>
  `;
}

function iconForSchool(school) {
  const typeClass = school.tipo === "Infanzia" ? "infanzia" : "primaria";
  return L.divIcon({
    className: "",
    html: `<div class="school-marker ${typeClass}"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6]
  });
}

function approximateCoordinates(school) {
  const center = municipalityCentroids.get(normalize(school.comune));
  if (!center) return null;
  const offset = deterministicOffset(school.codice);
  return [center[0] + offset[0], center[1] + offset[1]];
}

async function geocodeSchool(school) {
  const cacheKey = `schoolCoords:${school.codice}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (_) {}

  const query = [
    school.denominazione,
    school.indirizzo,
    school.cap,
    school.comune,
    school.provincia,
    "Basilicata",
    "Italia"
  ].filter(Boolean).join(", ");

  try {
    const response = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1&lang=it`,
      { headers: { "Accept": "application/json" } }
    );
    if (!response.ok) throw new Error("Geocodifica non disponibile");
    const data = await response.json();
    const feature = data.features?.[0];
    if (!feature) return null;
    const [lon, lat] = feature.geometry.coordinates;
    const coords = [lat, lon];
    try { localStorage.setItem(cacheKey, JSON.stringify(coords)); } catch (_) {}
    return coords;
  } catch (error) {
    console.warn(error);
    return null;
  }
}

function createOrUpdateMarker(school, coordinates, approximate = true) {
  if (!coordinates) return null;
  let marker = markers.get(school.codice);
  if (!marker) {
    marker = L.marker(coordinates, { icon: iconForSchool(school) }).addTo(map);
    markers.set(school.codice, marker);
  } else {
    marker.setLatLng(coordinates);
  }
  marker.bindPopup(popupHtml(school, coordinates, approximate), { maxWidth: 350 });
  return marker;
}

async function focusSchool(school) {
  activeCode = school.codice;
  document.querySelectorAll(".school-card").forEach(card => {
    card.classList.toggle("is-active", card.dataset.code === school.codice);
  });

  let coords = await geocodeSchool(school);
  let approximate = false;

  if (!coords) {
    coords = approximateCoordinates(school);
    approximate = true;
  }

  if (!coords) return;

  const marker = createOrUpdateMarker(school, coords, approximate);
  map.flyTo(coords, approximate ? 13 : 17, { duration: .8 });
  marker?.openPopup();
}

function populateMunicipalities() {
  const select = document.querySelector("#school-municipality");
  const names = [...new Set(schools.map(s => s.comune))].sort((a, b) => a.localeCompare(b, "it"));
  names.forEach(name => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
}

function applyFilters() {
  const query = normalize(document.querySelector("#school-search").value);
  const province = document.querySelector("#school-province").value;
  const type = document.querySelector("#school-type").value;
  const municipality = document.querySelector("#school-municipality").value;

  filteredSchools = schools.filter(school => {
    const haystack = normalize([
      school.denominazione,
      school.comune,
      school.indirizzo,
      school.istituto,
      school.codice
    ].join(" "));

    return (!query || haystack.includes(query)) &&
      (province === "ALL" || school.provincia === province) &&
      (type === "ALL" || school.tipo === type) &&
      (municipality === "ALL" || school.comune === municipality);
  });

  visibleLimit = PAGE_SIZE;
  renderSchools();
}

function renderSchools() {
  const list = document.querySelector("#schools-list");
  const visible = filteredSchools.slice(0, visibleLimit);
  const fragment = document.createDocumentFragment();
  list.innerHTML = "";

  visible.forEach(school => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "school-card";
    button.dataset.code = school.codice;
    button.innerHTML = `
      <span class="school-card__type ${school.tipo.toLowerCase()}">${escapeHtml(school.tipo)}</span>
      <span class="school-card__body">
        <strong>${escapeHtml(school.denominazione)}</strong>
        <span>${escapeHtml(school.comune)}${school.indirizzo ? ` · ${escapeHtml(school.indirizzo)}` : ""}</span>
        <small>${escapeHtml(school.istituto)}</small>
      </span>
    `;
    button.addEventListener("click", () => focusSchool(school));
    fragment.appendChild(button);
  });

  list.appendChild(fragment);

  document.querySelector("#schools-count").textContent =
    `${visible.length} di ${filteredSchools.length}`;

  const loadMore = document.querySelector("#schools-load-more");
  loadMore.hidden = visible.length >= filteredSchools.length;
  loadMore.textContent = `Mostra altre scuole (${filteredSchools.length - visible.length})`;
}

async function initMapAndData() {
  const [schoolsResponse, geoResponse] = await Promise.all([
    fetch("scuole.json", { cache: "force-cache" }),
    fetch(GEOJSON_URL, { cache: "force-cache" })
  ]);

  if (!schoolsResponse.ok) throw new Error("Impossibile caricare le scuole.");
  if (!geoResponse.ok) throw new Error("Impossibile caricare la mappa dei comuni.");

  schools = await schoolsResponse.json();
  const geojson = await geoResponse.json();

  geojson.features.forEach(feature => {
    const center = polygonCenter(feature);
    if (center) municipalityCentroids.set(normalize(getFeatureName(feature)), center);
  });

  map = L.map("schools-map", { scrollWheelZoom: false }).setView([40.49, 16.08], 8);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  const boundsLayer = L.geoJSON(geojson, {
    style: {
      color: "#b8c4c9",
      weight: 1,
      fillColor: "#eef2f3",
      fillOpacity: .35
    }
  }).addTo(map);

  map.fitBounds(boundsLayer.getBounds(), { padding: [12, 12] });

  schools.forEach(school => {
    const coords = approximateCoordinates(school);
    if (coords) createOrUpdateMarker(school, coords, true);
  });

  populateMunicipalities();
  filteredSchools = [...schools];
  renderSchools();

  document.querySelector("#schools-total").textContent = `${schools.length} plessi`;
}

document.querySelectorAll("#school-province, #school-type, #school-municipality")
  .forEach(element => element.addEventListener("change", applyFilters));

document.querySelector("#school-search").addEventListener("input", applyFilters);

document.querySelector("#schools-load-more").addEventListener("click", () => {
  visibleLimit += PAGE_SIZE;
  renderSchools();
});

initMapAndData().catch(error => {
  console.error(error);
  document.querySelector("#schools-list").innerHTML =
    `<p>Errore durante il caricamento: ${escapeHtml(error.message)}</p>`;
  document.querySelector("#schools-map").innerHTML =
    '<div class="map-loading">Mappa momentaneamente non disponibile.</div>';
});
