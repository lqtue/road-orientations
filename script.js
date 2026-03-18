// --- Cohen-Sutherland Line Clipping (For local vector data) ---
function lineclip(points, bbox, result) {
    var len = points.length, codeA = bitCode(points[0], bbox), part = [], i, a, b, codeB, lastCode;
    if (!result) result = [];
    for (i = 1; i < len; i++) {
        a = points[i - 1]; b = points[i]; codeB = lastCode = bitCode(b, bbox);
        while (true) {
            if (!(codeA | codeB)) { part.push(a); if (codeB !== lastCode) { part.push(b); if (i < len - 1) { result.push(part); part = []; } } else if (i === len - 1) { part.push(b); } break; }
            else if (codeA & codeB) { break; }
            else if (codeA) { a = intersect(a, b, codeA, bbox); codeA = bitCode(a, bbox); }
            else { b = intersect(a, b, codeB, bbox); codeB = bitCode(b, bbox); }
        }
        codeA = lastCode;
    }
    if (part.length) result.push(part);
    return result;
}
function intersect(a, b, edge, bbox) {
    return edge & 8 ? [a[0] + (b[0] - a[0]) * (bbox[3] - a[1]) / (b[1] - a[1]), bbox[3]] : edge & 4 ? [a[0] + (b[0] - a[0]) * (bbox[1] - a[1]) / (b[1] - a[1]), bbox[1]] : edge & 2 ? [bbox[2], a[1] + (b[1] - a[1]) * (bbox[2] - a[0]) / (b[0] - a[0])] : edge & 1 ? [bbox[0], a[1] + (b[1] - a[1]) * (bbox[0] - a[0]) / (b[0] - a[0])] : null;
}
function bitCode(p, bbox) {
    var code = 0; if (p[0] < bbox[0]) code |= 1; else if (p[0] > bbox[2]) code |= 2; if (p[1] < bbox[1]) code |= 4; else if (p[1] > bbox[3]) code |= 8; return code;
}

// --- Config ---
let pinnedCenter = [106.6297, 10.8231]; // Default: HCMC
const dataCache = {};
let currentSegments = [];
let activeAbortController = null;

// Global storage for tooltip math
let globalNormalizedBins = [];

let radii = [1.0, 3.0, 5.0];
let hoveredRingIndex = -1;
let analysisMode = 'cumulative';
let lastSegmentCount = 0;

let compareCenter = null;
let compareSegments = [];
let compareAbortController = null;
let compareNormalizedBins = [];

const h = 120;
const r = h / 2;
const numBins = 64;
const ringColors = ['rgb(255, 99, 132)', 'rgb(54, 162, 235)', 'rgb(255, 206, 86)', 'rgb(75, 192, 192)', 'rgb(153, 102, 255)'];

function applyAutoCollapse() {
  const explainer = document.getElementById('explainer');
  if (!explainer) return;
  if (window.innerHeight < 900) {
    explainer.removeAttribute('open');
  }
}

// --- Init Map & Geocoder ---
const map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    center: pinnedCenter,
    zoom: 12
});

const centerMarker = new maplibregl.Marker({ color: '#1e293b', draggable: true })
    .setLngLat(pinnedCenter)
    .addTo(map);

// Nominatim Geocoder Implementation
const geocoderApi = {
    forwardGeocode: async (config) => {
        const features = [];
        try {
            const request = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(config.query)}&format=geojson&polygon_geojson=1&addressdetails=1`;
            const response = await fetch(request);
            const geojson = await response.json();
            for (let feature of geojson.features) {
                let center = [
                    parseFloat(feature.properties.lon),
                    parseFloat(feature.properties.lat)
                ];
                features.push({
                    type: 'Feature', geometry: { type: 'Point', coordinates: center },
                    place_name: feature.properties.display_name, properties: feature.properties,
                    text: feature.properties.display_name, place_type: ['place'], center: center
                });
            }
        } catch (e) { console.error("Geocoder failed", e); }
        return { features: features };
    }
};

const geocoder = new MaplibreGeocoder(geocoderApi, { maplibregl: maplibregl, marker: false });
document.getElementById('search-wrapper').appendChild(geocoder.onAdd(map));

geocoder.on('result', (e) => {
    pinnedCenter = e.result.center;
    centerMarker.setLngLat(pinnedCenter);
    document.getElementById('location-name').textContent = e.result.place_name || e.result.text || '—';
    updateCenterInfo();
    updateMapRings();
    triggerHybridAnalysis();
    updateHash();
});

const CITY_PRESETS = {
  manhattan:  { name: 'Manhattan',  center: [-73.9840, 40.7549], zoom: 13 },
  paris:      { name: 'Paris',      center: [2.3522,   48.8566], zoom: 13 },
  barcelona:  { name: 'Barcelona',  center: [2.1734,   41.3851], zoom: 13 },
  tokyo:      { name: 'Tokyo',      center: [139.6503, 35.6762], zoom: 13 },
  hcmc:       { name: 'HCMC',       center: [106.6297, 10.8231], zoom: 12 },
};

// Toggle preset dropdown visibility
document.getElementById('preset-trigger').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('preset-menu');
  menu.hidden = !menu.hidden;
});

// Close dropdown when clicking outside
document.addEventListener('click', () => {
  document.getElementById('preset-menu').hidden = true;
});

// Handle preset selection
document.getElementById('preset-menu').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const preset = CITY_PRESETS[li.dataset.city];
  if (!preset) return;
  document.getElementById('preset-menu').hidden = true;
  pinnedCenter = preset.center;
  centerMarker.setLngLat(pinnedCenter);
  map.flyTo({ center: pinnedCenter, zoom: preset.zoom });
  document.getElementById('location-name').textContent = preset.name;
  updateCenterInfo();
  updateMapRings();
  triggerHybridAnalysis();
  updateHash();
});

async function reverseGeocodePin(lngLat) {
  const [lng, lat] = lngLat;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
    document.getElementById('location-name').textContent =
      `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`;
  }, 3000);

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&zoom=10&format=json`;
    const res = await fetch(url, { signal: controller.signal });
    const data = await res.json();
    clearTimeout(timer);
    document.getElementById('location-name').textContent =
      data.display_name || `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`;
  } catch (e) {
    clearTimeout(timer);
    if (e.name !== 'AbortError') {
      document.getElementById('location-name').textContent =
        `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`;
    }
  }
}

centerMarker.on('dragend', () => {
  const lngLat = centerMarker.getLngLat();
  pinnedCenter = [lngLat.lng, lngLat.lat];
  updateCenterInfo();
  updateMapRings();
  triggerHybridAnalysis();
  reverseGeocodePin(pinnedCenter);
  updateHash();
});

function updateCenterInfo() {
    document.getElementById('center-info').textContent = `${pinnedCenter[1].toFixed(4)}°N, ${pinnedCenter[0].toFixed(4)}°E`;
}

// --- UI Setup ---
document.getElementById('mode-cumulative').onclick = (e) => { analysisMode = 'cumulative'; updateUIButtons(e.target); processAndDrawChart(); renderBreakdown(); updateHash(); };
document.getElementById('mode-ring-only').onclick = (e) => { analysisMode = 'ring-only'; updateUIButtons(e.target); processAndDrawChart(); renderBreakdown(); updateHash(); };

function updateUIButtons(el) {
    document.querySelectorAll('.mode-pill').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    updateMapRings();
}

function getRingColor(i) { return ringColors[i % ringColors.length]; }

function renderRadiiUI() {
    const container = document.getElementById('radii-list');
    container.innerHTML = '';
    radii.forEach((radius, i) => {
        const row = document.createElement('div');
        row.className = 'radius-row';
        if (hoveredRingIndex === i) {
            row.style.borderColor = getRingColor(i);
            row.style.boxShadow = `0 2px 8px ${getRingColor(i).replace('rgb', 'rgba').replace(')', ', 0.2)')}`;
        }
        row.innerHTML = `<div class="color-swatch" style="background-color: ${getRingColor(i)}"></div>
            <input type="number" value="${radius}" step="0.5" min="0.5" data-index="${i}">
            <span class="unit-label">km</span><button class="remove-btn">×</button>`;

        row.querySelector('input').onchange = (e) => {
            let val = parseFloat(e.target.value);
            if (val > 0) { radii[i] = val; radii.sort((a, b) => a - b); renderRadiiUI(); triggerHybridAnalysis(); updateMapRings(); updateHash(); }
        };
        row.querySelector('.remove-btn').onclick = () => {
            if (radii.length > 1) { radii.splice(i, 1); hoveredRingIndex = -1; renderRadiiUI(); triggerHybridAnalysis(); updateMapRings(); updateHash(); }
        };
        container.appendChild(row);
    });
}

document.getElementById('add-radius-btn').onclick = () => { radii.push(radii[radii.length - 1] + 2.0); renderRadiiUI(); triggerHybridAnalysis(); updateMapRings(); updateHash(); };

function renderBreakdown() {
  const list = document.getElementById('breakdown-list');
  const toggle = document.getElementById('breakdown-toggle');
  if (!list) return;
  list.innerHTML = '';

  const MAX_VISIBLE = 3;
  const showAll = list.dataset.expanded === 'true';

  radii.forEach((radius, i) => {
    const bins = globalNormalizedBins[i];
    const row = document.createElement('div');
    row.className = 'breakdown-row';
    if (hoveredRingIndex === i) row.classList.add('highlighted');

    let label = '—';
    if (bins) {
      const { dominant } = computeDominantDirections(bins);
      if (dominant) {
        label = `${binToCompassLabel(dominant.bins[0])}–${binToCompassLabel(dominant.bins[1])} · ${dominant.combined.toFixed(0)}%`;
      }
    }

    row.innerHTML = `
      <span class="swatch" style="background:${getRingColor(i)}"></span>
      <span>${radius} km</span>
      <span class="ring-stat">${label}</span>`;

    if (i >= MAX_VISIBLE && !showAll) {
      row.style.display = 'none';
    }
    list.appendChild(row);
  });

  if (toggle) {
    if (radii.length > MAX_VISIBLE) {
      toggle.hidden = false;
      toggle.textContent = showAll ? 'Show less ↑' : 'Show all ↓';
      toggle.onclick = () => {
        list.dataset.expanded = showAll ? 'false' : 'true';
        renderBreakdown();
      };
    } else {
      toggle.hidden = true;
    }
  }
}

function updateStatus(state) {
  const el = document.getElementById('data-status');
  if (!el) return;
  el.className = `badge ${state}`;
  if (state === 'fast') el.innerText = 'FAST';
  if (state === 'fetching') el.innerText = 'FETCHING…';
  if (state === 'precise') {
    el.innerText = 'PRECISE';
    const line2 = document.getElementById('data-source-line2');
    if (line2) {
      const today = new Date().toISOString().slice(0, 10);
      const maxR = radii[radii.length - 1];
      line2.textContent = `${lastSegmentCount.toLocaleString()} segments · ${maxR} km radius · ${today}`;
    }
  }
  if (state === 'timeout') {
    el.textContent = 'TIMEOUT';
  }
}

// --- Hybrid Data Engine ---
function extractLocalSegments() {
    const bounds = map.getBounds();
    const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
    const features = map.queryRenderedFeatures().filter(f =>
        f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') &&
        f.layer && f.layer['source-layer'] && (f.layer['source-layer'] === 'street' || f.layer['source-layer'] === 'transportation')
    );

    const segments = [];
    features.forEach(f => {
        const isTwoWay = f.properties.oneway !== 'yes' && f.properties.oneway !== 1 && f.properties.oneway !== true;
        const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
        lines.forEach(line => {
            const clipped = lineclip(line, bbox);
            clipped.forEach(clipLine => {
                for (let i = 0; i < clipLine.length - 1; i++) {
                    segments.push({ p1: clipLine[i], p2: clipLine[i + 1], isTwoWay });
                }
            });
        });
    });
    return segments;
}

async function fetchOverpassSegments(centerCoords, maxRadiusKm) {
    if (activeAbortController) activeAbortController.abort();
    activeAbortController = new AbortController();
    const signal = activeAbortController.signal;

    const [lng, lat] = centerCoords;
    const radiusMeters = maxRadiusKm * 1000;
    const cacheKey = `${lng},${lat},${maxRadiusKm}`;

    if (dataCache[cacheKey]) return dataCache[cacheKey];

    updateStatus('fetching');

    const query = `[out:json][timeout:25];(way["highway"](around:${radiusMeters},${lat},${lng}););out geom;`;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

    try {
        const response = await fetch(url, { signal });
        const data = await response.json();
        const segments = [];
        data.elements.forEach(el => {
            if (el.type === 'way' && el.geometry) {
                const coords = el.geometry.map(pt => [pt.lon, pt.lat]);
                const isTwoWay = !(el.tags && (el.tags.oneway === 'yes' || el.tags.oneway === '1' || el.tags.oneway === '-1'));
                for (let i = 0; i < coords.length - 1; i++) {
                    segments.push({ p1: coords[i], p2: coords[i + 1], isTwoWay });
                }
            }
        });
        lastSegmentCount = segments.length;
        dataCache[cacheKey] = segments;
        return segments;
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Previous fetch cancelled');
        } else {
            updateStatus('timeout');
            document.getElementById('retry-btn').hidden = false;
        }
        return null;
    }
}

async function triggerHybridAnalysis() {
    currentSegments = extractLocalSegments();
    updateStatus('fast');
    processAndDrawChart();
    renderBreakdown();

    const fetchRadius = radii[radii.length - 1] + 1;
    const preciseSegments = await fetchOverpassSegments(pinnedCenter, fetchRadius);

    if (preciseSegments) {
        const canvasEl = document.getElementById('canvas');
        canvasEl.style.transition = 'opacity 0.2s';
        canvasEl.style.opacity = '0';
        setTimeout(() => {
            currentSegments = preciseSegments;
            updateStatus('precise');
            processAndDrawChart();
            renderBreakdown();
            canvasEl.style.opacity = '1';
            canvasEl.style.transition = '';
        }, 220);
    } else if (!activeAbortController || !activeAbortController.signal.aborted) {
        updateStatus('fast');
    }
}

// --- Mathematics & Canvas Drawing ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
canvas.style.width = canvas.style.height = h + 'px';
canvas.width = canvas.height = h;
if (window.devicePixelRatio > 1) { canvas.width = canvas.height = h * 2; ctx.scale(2, 2); }

const canvas2 = document.getElementById('canvas-2');
const ctx2 = canvas2 ? canvas2.getContext('2d') : null;
if (canvas2) {
  canvas2.style.width = canvas2.style.height = h + 'px';
  canvas2.width = canvas2.height = h;
  if (window.devicePixelRatio > 1) { canvas2.width = canvas2.height = h * 2; ctx2.scale(2, 2); }
}

function processAndDrawChart() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const bearing = map.getBearing();
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(-bearing * Math.PI / 180);

    // Crosshair
    ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke();

    // Scale grid circles at 25%, 50%, 75%, 100% of r
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 0.5;
    for (let g = 1; g <= 4; g++) {
      ctx.beginPath();
      ctx.arc(0, 0, r * (g / 4), 0, 2 * Math.PI);
      ctx.stroke();
    }

    // Compass labels
    const labelOffset = r - 4;
    ctx.fillStyle = '#64748b';
    ctx.font = `bold ${Math.round(h * 0.09)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    [['N', 0, -labelOffset], ['S', 0, labelOffset], ['E', labelOffset, 0], ['W', -labelOffset, 0]]
      .forEach(([label, x, y]) => ctx.fillText(label, x, y));

    const noDataMsg = document.getElementById('no-data-msg');
    if (!currentSegments || currentSegments.length === 0) {
      if (noDataMsg) noDataMsg.hidden = false;
      ctx.restore();
      return;
    }
    if (noDataMsg) noDataMsg.hidden = true;

    const ruler = new CheapRuler(pinnedCenter[1]);
    const stackedBins = Array.from({ length: radii.length }, () => new Float64Array(numBins));
    const maxRadius = radii[radii.length - 1];

    currentSegments.forEach(seg => {
        const midPt = [(seg.p1[0] + seg.p2[0]) / 2, (seg.p1[1] + seg.p2[1]) / 2];
        const distToCenter = ruler.distance(pinnedCenter, midPt);
        if (distToCenter > maxRadius) return;

        let ringIndex = 0;
        for (let rIdx = 0; rIdx < radii.length; rIdx++) {
            if (distToCenter <= radii[rIdx]) { ringIndex = rIdx; break; }
        }

        const segBearing = ruler.bearing(seg.p1, seg.p2);
        const distance = ruler.distance(seg.p1, seg.p2);
        const k0 = Math.round((segBearing + 360) * numBins / 360) % numBins;
        const k1 = Math.round((segBearing + 180) * numBins / 360) % numBins;

        stackedBins[ringIndex][k0] += distance;
        if (seg.isTwoWay) stackedBins[ringIndex][k1] += distance;
    });

    const ringTotals = new Float64Array(radii.length);
    for (let ring = 0; ring < radii.length; ring++) {
        for (let b = 0; b < numBins; b++) ringTotals[ring] += stackedBins[ring][b];
    }

    let maxPercentage = 0;
    globalNormalizedBins = Array.from({ length: radii.length }, () => new Float64Array(numBins));

    if (analysisMode === 'cumulative') {
        const cumulativeTotals = new Float64Array(radii.length);
        for (let ring = 0; ring < radii.length; ring++) {
            for (let b = 0; b < numBins; b++) {
                for (let k = 0; k <= ring; k++) cumulativeTotals[ring] += stackedBins[k][b];
            }
        }
        const sharedTotal = cumulativeTotals[radii.length - 1];
        if (sharedTotal > 0) {
            for (let ring = 0; ring < radii.length; ring++) {
                for (let b = 0; b < numBins; b++) {
                    let cumVal = 0;
                    for (let k = 0; k <= ring; k++) cumVal += stackedBins[k][b];
                    const pct = (cumVal / sharedTotal) * 100;
                    globalNormalizedBins[ring][b] = pct;
                    if (pct > maxPercentage) maxPercentage = pct;
                }
            }
        }
    } else {
        for (let ring = 0; ring < radii.length; ring++) {
            if (ringTotals[ring] === 0) continue;
            for (let b = 0; b < numBins; b++) {
                const pct = (stackedBins[ring][b] / ringTotals[ring]) * 100;
                globalNormalizedBins[ring][b] = pct;
                if (pct > maxPercentage) maxPercentage = pct;
            }
        }
    }

    if (maxPercentage === 0) { ctx.restore(); return; }

    const ringsToDraw = [];
    for (let i = radii.length - 1; i >= 0; i--) if (i !== hoveredRingIndex) ringsToDraw.push(i);
    if (hoveredRingIndex !== -1 && hoveredRingIndex < radii.length) ringsToDraw.push(hoveredRingIndex);

    for (let rIdx = 0; rIdx < ringsToDraw.length; rIdx++) {
        const ring = ringsToDraw[rIdx];
        if (ringTotals[ring] === 0) continue;

        const isHovered = hoveredRingIndex === -1 || hoveredRingIndex === ring;
        ctx.fillStyle = getRingColor(ring);
        ctx.globalAlpha = isHovered ? (hoveredRingIndex !== -1 ? 0.85 : 0.6) : 0.1;

        ctx.beginPath(); ctx.moveTo(0, 0);
        for (let b = 0; b < numBins; b++) {
            const a0 = ((b - 0.5) * 360 / numBins - 90) * Math.PI / 180;
            const a1 = ((b + 0.5) * 360 / numBins - 90) * Math.PI / 180;
            const percentage = globalNormalizedBins[ring][b];
            if (percentage > 0) {
                ctx.arc(0, 0, r * Math.sqrt(percentage / maxPercentage), a0, a1, false);
                ctx.lineTo(0, 0);
            }
        }
        ctx.fill();
        ctx.globalAlpha = isHovered ? 1.0 : 0.2; ctx.strokeStyle = getRingColor(ring); ctx.lineWidth = 1.0; ctx.stroke();
    }
    ctx.globalAlpha = 1.0; ctx.restore();

    // Update dominant direction panel
    const outerBins = globalNormalizedBins[radii.length - 1];
    const { dominant, secondary } = computeDominantDirections(outerBins);
    const domEl = document.getElementById('dominant-value');
    const secEl = document.getElementById('secondary-value');
    if (domEl) {
      if (dominant) {
        const label = `${binToCompassLabel(dominant.bins[0])} – ${binToCompassLabel(dominant.bins[1])}`;
        domEl.textContent = `${label} · ${dominant.combined.toFixed(1)}%`;
      } else {
        domEl.textContent = '—';
      }
    }
    if (secEl) {
      secEl.textContent = secondary
        ? `Secondary: ${binToCompassLabel(secondary.bins[0])}–${binToCompassLabel(secondary.bins[1])}`
        : '';
    }
}

// --- Map Ring Geometries ---
function updateMapRings() {
    if (!map.isStyleLoaded()) return;
    const features = [];
    for (let i = radii.length - 1; i >= 0; i--) {
        const radius = radii[i];
        const outerCircle = turf.circle(pinnedCenter, radius, { steps: 64, units: 'kilometers' });
        let coords = [outerCircle.geometry.coordinates[0]];
        if (analysisMode === 'ring-only' && i > 0) {
            const innerCircle = turf.circle(pinnedCenter, radii[i - 1], { steps: 64, units: 'kilometers' });
            coords.push(innerCircle.geometry.coordinates[0].slice().reverse());
        }
        features.push(turf.polygon(coords, {
            ringIndex: i, color: getRingColor(i),
            fillOpacity: Math.max(0.02, hoveredRingIndex === -1 ? 0.15 : (hoveredRingIndex === i ? 0.3 : 0.05)),
            lineOpacity: Math.max(0.05, hoveredRingIndex === -1 ? 0.8 : (hoveredRingIndex === i ? 1.0 : 0.1))
        }));
    }
    const geojson = { type: "FeatureCollection", features: features };

    if (map.getSource('analysis-rings')) { map.getSource('analysis-rings').setData(geojson); }
    else {
        map.addSource('analysis-rings', { type: 'geojson', data: geojson });
        map.addLayer({ 'id': 'analysis-rings-fill', 'type': 'fill', 'source': 'analysis-rings', 'paint': { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'fillOpacity'] } });
        map.addLayer({ 'id': 'analysis-rings-line', 'type': 'line', 'source': 'analysis-rings', 'paint': { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': ['get', 'lineOpacity'], 'line-dasharray': [2, 2] } });
    }
}

// --- Helpers for Tooltips ---
function getCompassDirection(degrees) {
    const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    const index = Math.round(((degrees %= 360) < 0 ? degrees + 360 : degrees) / 22.5) % 16;
    return dirs[index];
}

function computeDominantDirections(bins, numBins = 64) {
  const half = numBins / 2;
  const pairs = [];
  for (let k = 0; k < half; k++) {
    pairs.push({ bins: [k, k + half], combined: bins[k] + bins[k + half] });
  }
  pairs.sort((a, b) => b.combined - a.combined);
  const dominant = pairs[0].combined > 0 ? pairs[0] : null;
  const secondary = pairs[1] && pairs[1].combined > 0 ? pairs[1] : null;
  return { dominant, secondary };
}

function binToCompassLabel(binIndex, numBins = 64) {
  const deg = (binIndex / numBins) * 360;
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function hideTooltip() {
    document.getElementById('chart-tooltip').style.display = 'none';
}

// --- Permalink ---
function encodeHash({ lat, lng, zoom, radii, mode, explainerOpen }) {
  const r = radii.join('-');
  const e = explainerOpen ? '' : ',0';
  return `#${lat.toFixed(4)},${lng.toFixed(4)},${zoom},${r},${mode}${e}`;
}

function decodeHash(hash) {
  if (!hash || hash.length < 2) return null;
  const parts = hash.slice(1).split(',');
  if (parts.length < 5) return null;
  try {
    return {
      lat: parseFloat(parts[0]),
      lng: parseFloat(parts[1]),
      zoom: parseInt(parts[2], 10),
      radii: parts[3].split('-').map(Number),
      mode: parts[4],
      explainerOpen: parts[5] !== '0',
    };
  } catch { return null; }
}

function updateHash() {
  const explainer = document.getElementById('explainer');
  const explainerOpen = explainer ? explainer.hasAttribute('open') : true;
  window.location.hash = encodeHash({
    lat: pinnedCenter[1],
    lng: pinnedCenter[0],
    zoom: Math.round(map.getZoom()),
    radii,
    mode: analysisMode,
    explainerOpen,
  });
}

document.getElementById('retry-btn').addEventListener('click', () => {
  document.getElementById('retry-btn').hidden = true;
  triggerHybridAnalysis();
});

// --- City Comparison Mode ---
function updateCompareStatus(state) {
  const badge = document.getElementById('data-status-2');
  if (!badge) return;
  badge.className = `badge ${state}`;
  badge.textContent = state.toUpperCase();
}

async function triggerCompareAnalysis() {
  if (!compareCenter) return;

  // FAST pass
  compareSegments = extractLocalSegments();
  updateCompareStatus('fast');
  processAndDrawCompareChart();

  // PRECISE pass
  if (compareAbortController) compareAbortController.abort();
  compareAbortController = new AbortController();
  const signal = compareAbortController.signal;

  const maxR = radii[radii.length - 1] + 1;
  const [lng, lat] = compareCenter;
  const query = `[out:json][timeout:25];(way["highway"](around:${maxR * 1000},${lat},${lng}););out geom;`;
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

  updateCompareStatus('fetching');
  try {
    const res = await fetch(url, { signal });
    const data = await res.json();
    const segs = [];
    data.elements.forEach(el => {
      if (el.type === 'way' && el.geometry) {
        const coords = el.geometry.map(pt => [pt.lon, pt.lat]);
        const isTwoWay = !(el.tags && (el.tags.oneway === 'yes' || el.tags.oneway === '1' || el.tags.oneway === '-1'));
        for (let i = 0; i < coords.length - 1; i++) {
          segs.push({ p1: coords[i], p2: coords[i + 1], isTwoWay });
        }
      }
    });
    compareSegments = segs;
    updateCompareStatus('precise');
    processAndDrawCompareChart();
  } catch (e) {
    if (e.name !== 'AbortError') updateCompareStatus('timeout');
  }
}

function processAndDrawCompareChart() {
  if (!canvas2 || !ctx2) return;

  const ruler = new CheapRuler(compareCenter[1]);
  const stackedBins = Array.from({ length: radii.length }, () => new Float64Array(numBins));

  compareSegments.forEach(seg => {
    const midPt = [(seg.p1[0] + seg.p2[0]) / 2, (seg.p1[1] + seg.p2[1]) / 2];
    if (ruler.distance(compareCenter, midPt) > radii[radii.length - 1]) return;
    let ringIndex = 0;
    for (let rIdx = 0; rIdx < radii.length; rIdx++) {
      if (ruler.distance(compareCenter, midPt) <= radii[rIdx]) { ringIndex = rIdx; break; }
    }
    const segBearing = ruler.bearing(seg.p1, seg.p2);
    const distance = ruler.distance(seg.p1, seg.p2);
    const k0 = Math.round((segBearing + 360) * numBins / 360) % numBins;
    const k1 = Math.round((segBearing + 180) * numBins / 360) % numBins;
    stackedBins[ringIndex][k0] += distance;
    if (seg.isTwoWay) stackedBins[ringIndex][k1] += distance;
  });

  // Normalise (respects analysisMode)
  compareNormalizedBins = Array.from({ length: radii.length }, () => new Float64Array(numBins));
  let maxPct = 0;

  const ringTotals2 = new Float64Array(radii.length);
  for (let ring = 0; ring < radii.length; ring++) {
    for (let b = 0; b < numBins; b++) ringTotals2[ring] += stackedBins[ring][b];
  }

  if (analysisMode === 'cumulative') {
    const cumulativeTotals = new Float64Array(radii.length);
    for (let ring = 0; ring < radii.length; ring++) {
      for (let b = 0; b < numBins; b++) {
        for (let k = 0; k <= ring; k++) cumulativeTotals[ring] += stackedBins[k][b];
      }
    }
    const sharedTotal = cumulativeTotals[radii.length - 1];
    if (sharedTotal > 0) {
      for (let ring = 0; ring < radii.length; ring++) {
        for (let b = 0; b < numBins; b++) {
          let cumVal = 0;
          for (let k = 0; k <= ring; k++) cumVal += stackedBins[k][b];
          const pct = (cumVal / sharedTotal) * 100;
          compareNormalizedBins[ring][b] = pct;
          if (pct > maxPct) maxPct = pct;
        }
      }
    }
  } else {
    for (let ring = 0; ring < radii.length; ring++) {
      if (ringTotals2[ring] === 0) continue;
      for (let b = 0; b < numBins; b++) {
        const pct = (stackedBins[ring][b] / ringTotals2[ring]) * 100;
        compareNormalizedBins[ring][b] = pct;
        if (pct > maxPct) maxPct = pct;
      }
    }
  }

  // Draw on canvas2
  ctx2.clearRect(0, 0, canvas2.width, canvas2.height);
  ctx2.save();
  ctx2.translate(r, r);

  // Grid circles
  ctx2.strokeStyle = 'rgba(0,0,0,0.08)'; ctx2.lineWidth = 0.5;
  for (let g = 1; g <= 4; g++) {
    ctx2.beginPath(); ctx2.arc(0, 0, r * (g / 4), 0, 2 * Math.PI); ctx2.stroke();
  }

  // Compass labels
  ctx2.fillStyle = '#64748b';
  ctx2.font = `bold ${Math.round(h * 0.09)}px Inter, system-ui, sans-serif`;
  ctx2.textAlign = 'center'; ctx2.textBaseline = 'middle';
  [['N',0,-(r-8)],['S',0,r-8],['E',r-8,0],['W',-(r-8),0]].forEach(([l,x,y]) => ctx2.fillText(l,x,y));

  if (maxPct > 0) {
    for (let ring = radii.length - 1; ring >= 0; ring--) {
      ctx2.fillStyle = getRingColor(ring);
      ctx2.globalAlpha = 0.6;
      ctx2.beginPath(); ctx2.moveTo(0, 0);
      for (let b = 0; b < numBins; b++) {
        const a0 = ((b - 0.5) * 360 / numBins - 90) * Math.PI / 180;
        const a1 = ((b + 0.5) * 360 / numBins - 90) * Math.PI / 180;
        const pct = compareNormalizedBins[ring][b];
        if (pct > 0) { ctx2.arc(0, 0, r * Math.sqrt(pct / maxPct), a0, a1); ctx2.lineTo(0, 0); }
      }
      ctx2.fill();
    }
  }
  ctx2.globalAlpha = 1.0; ctx2.restore();

  // Update dominant direction display
  const outerBins2 = compareNormalizedBins[radii.length - 1];
  const { dominant: dom2, secondary: sec2 } = computeDominantDirections(outerBins2);
  const domEl2 = document.getElementById('dominant-value-2');
  const secEl2 = document.getElementById('secondary-value-2');
  if (domEl2) domEl2.textContent = dom2
    ? `${binToCompassLabel(dom2.bins[0])} – ${binToCompassLabel(dom2.bins[1])} · ${dom2.combined.toFixed(1)}%`
    : '—';
  if (secEl2) secEl2.textContent = sec2
    ? `Secondary: ${binToCompassLabel(sec2.bins[0])}–${binToCompassLabel(sec2.bins[1])}`
    : '';
}

// --- Event Listeners ---
map.on('load', () => {
    applyAutoCollapse();
    window.addEventListener('resize', applyAutoCollapse);

    const saved = decodeHash(window.location.hash);
    if (saved) {
      pinnedCenter = [saved.lng, saved.lat];
      centerMarker.setLngLat(pinnedCenter);
      map.setCenter(pinnedCenter);
      map.setZoom(saved.zoom);
      radii = saved.radii;
      analysisMode = saved.mode;
      const explainerEl = document.getElementById('explainer');
      if (explainerEl && !saved.explainerOpen) {
        explainerEl.removeAttribute('open');
      }
      document.querySelectorAll('.mode-pill').forEach(b => b.classList.remove('active'));
      const activeId = analysisMode === 'cumulative' ? 'mode-cumulative' : 'mode-ring-only';
      const activeBtn = document.getElementById(activeId);
      if (activeBtn) activeBtn.classList.add('active');
    }

    updateCenterInfo(); renderRadiiUI(); updateMapRings();
    setTimeout(() => { triggerHybridAnalysis(); }, 800);

    map.on('mousemove', 'analysis-rings-fill', (e) => {
        if (e.features.length > 0) {
            const idx = e.features[0].properties.ringIndex;
            if (idx !== hoveredRingIndex) { hoveredRingIndex = idx; map.getCanvas().style.cursor = 'pointer'; renderRadiiUI(); processAndDrawChart(); renderBreakdown(); updateMapRings(); }
        }
    });
    map.on('mouseleave', 'analysis-rings-fill', () => {
        if (hoveredRingIndex !== -1) { hoveredRingIndex = -1; map.getCanvas().style.cursor = ''; renderRadiiUI(); processAndDrawChart(); renderBreakdown(); updateMapRings(); }
    });

    map.on('click', (e) => {
      pinnedCenter = [e.lngLat.lng, e.lngLat.lat];
      centerMarker.setLngLat(pinnedCenter);
      updateCenterInfo();
      updateMapRings();
      triggerHybridAnalysis();
      reverseGeocodePin(pinnedCenter);
      updateHash();
    });

    // Compare mode toggle
    function enterCompareMode() {
      document.getElementById('panel-compare').hidden = false;
      document.body.classList.add('compare-mode');
    }
    function exitCompareMode() {
      document.getElementById('panel-compare').hidden = true;
      document.body.classList.remove('compare-mode');
    }

    document.getElementById('compare-btn').addEventListener('click', enterCompareMode);
    const compareBtnPanel = document.getElementById('compare-btn-panel');
    if (compareBtnPanel) compareBtnPanel.addEventListener('click', enterCompareMode);
    document.getElementById('compare-close').addEventListener('click', exitCompareMode);

    // Geocoder for second panel
    const geocoderApi2 = { forwardGeocode: geocoderApi.forwardGeocode };
    const geocoder2 = new MaplibreGeocoder(geocoderApi2, { maplibregl, marker: false });
    const wrapper2 = document.getElementById('search-wrapper-2');
    if (wrapper2) wrapper2.appendChild(geocoder2.onAdd(map));

    let compareMarker = null;

    geocoder2.on('result', (e) => {
      compareCenter = e.result.center;
      if (compareMarker) compareMarker.remove();
      compareMarker = new maplibregl.Marker({ color: '#3b82f6', draggable: false })
        .setLngLat(compareCenter).addTo(map);
      document.getElementById('location-name-2').textContent = e.result.place_name;
      document.getElementById('center-info-2').textContent =
        `${compareCenter[1].toFixed(4)}°N, ${compareCenter[0].toFixed(4)}°E`;
      if (compareCenter && pinnedCenter) {
        map.fitBounds([pinnedCenter, compareCenter], { padding: 60 });
      }
      triggerCompareAnalysis();
    });
});

map.on('moveend', () => {
    if (document.getElementById('data-status').classList.contains('fast')) {
        currentSegments = extractLocalSegments();
        processAndDrawChart();
        renderBreakdown();
    }
});

// Hover logic for chart + Tooltips
const canvasContainer = document.getElementById('canvas-container');
const tooltip = document.getElementById('chart-tooltip');

canvasContainer.addEventListener('mousemove', (e) => {
  const rect = canvasContainer.getBoundingClientRect();
  const mx = e.clientX - rect.left - r;
  const my = e.clientY - rect.top - r;
  const dist = Math.sqrt(mx * mx + my * my);

  if (dist > r) {
    if (hoveredRingIndex !== -1) {
      hoveredRingIndex = -1;
      renderRadiiUI(); processAndDrawChart(); renderBreakdown(); updateMapRings();
    }
    hideTooltip();
    return;
  }

  const bestRing = Math.min(Math.floor((dist / r) * radii.length), radii.length - 1);
  if (bestRing !== hoveredRingIndex) {
    hoveredRingIndex = bestRing;
    renderRadiiUI(); processAndDrawChart(); renderBreakdown(); updateMapRings();
  }

  if (globalNormalizedBins.length > 0 && hoveredRingIndex !== -1) {
    let angleDeg = (Math.atan2(my, mx) * 180 / Math.PI) + 90 + map.getBearing();
    angleDeg = (angleDeg % 360 + 360) % 360;
    const binIndex = Math.round(angleDeg * numBins / 360) % numBins;
    const percentage = globalNormalizedBins[hoveredRingIndex][binIndex];
    const compassDir = getCompassDirection(angleDeg);
    const color = getRingColor(hoveredRingIndex);
    const radius = radii[hoveredRingIndex];

    tooltip.style.display = 'block';
    tooltip.style.left = e.clientX + 'px';
    tooltip.style.top = e.clientY + 'px';
    tooltip.innerHTML = `
      <div style="display:flex;align-items:center;">
        <span class="tooltip-dot" style="background:${color}"></span>
        <span style="color:#94a3b8;">${radius}km ring</span>
      </div>
      <div class="tooltip-val">${compassDir} (${Math.round(angleDeg)}°)</div>
      <div style="font-size:0.82rem;color:#cbd5e1;margin-top:3px;">
        ${percentage.toFixed(2)}% of road length
      </div>`;
  }
});

canvasContainer.addEventListener('mouseleave', () => {
  if (hoveredRingIndex !== -1) {
    hoveredRingIndex = -1;
    renderRadiiUI(); processAndDrawChart(); renderBreakdown(); updateMapRings();
  }
  hideTooltip();
});

function exportPNG() {
  if (!globalNormalizedBins || globalNormalizedBins.length === 0) {
    alert('No data to export yet — search for a city first.');
    return;
  }
  const DPR = 2;
  const W = 600 * DPR, H = 300 * DPR;
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const offCtx = off.getContext('2d');

  // Background
  offCtx.fillStyle = 'white';
  offCtx.fillRect(0, 0, W, H);

  // Draw rose diagram (copy from existing canvas, scaled to left column)
  const src = document.getElementById('canvas');
  const roseSize = 260 * DPR;
  const rosePad = 20 * DPR;
  offCtx.drawImage(src, rosePad, (H - roseSize) / 2, roseSize, roseSize);

  // Divider
  offCtx.strokeStyle = '#f1f5f9';
  offCtx.lineWidth = 1 * DPR;
  offCtx.beginPath();
  offCtx.moveTo(roseSize + rosePad * 2, 20 * DPR);
  offCtx.lineTo(roseSize + rosePad * 2, H - 20 * DPR);
  offCtx.stroke();

  // Text column
  const tx = roseSize + rosePad * 3;
  const cityName = document.getElementById('location-name').textContent || 'Unknown';
  const dominant = document.getElementById('dominant-value').textContent || '—';
  const secondary = document.getElementById('secondary-value').textContent || '';

  offCtx.fillStyle = '#1e293b';
  offCtx.font = `bold ${18 * DPR}px Inter, system-ui, sans-serif`;
  offCtx.fillText(cityName, tx, 50 * DPR);

  offCtx.fillStyle = '#15803d';
  offCtx.font = `${14 * DPR}px Inter, system-ui, sans-serif`;
  offCtx.fillText(dominant, tx, 80 * DPR);

  if (secondary) {
    offCtx.fillStyle = '#64748b';
    offCtx.font = `${11 * DPR}px Inter, system-ui, sans-serif`;
    offCtx.fillText(secondary, tx, 100 * DPR);
  }

  // Ring breakdown lines
  let yOff = 130 * DPR;
  radii.forEach((radius, i) => {
    const bins = globalNormalizedBins[i];
    if (!bins) return;
    const { dominant: dom } = computeDominantDirections(bins);
    const label = dom
      ? `${radius}km: ${binToCompassLabel(dom.bins[0])}–${binToCompassLabel(dom.bins[1])} · ${dom.combined.toFixed(0)}%`
      : `${radius}km: —`;
    offCtx.fillStyle = getRingColor(i);
    offCtx.fillRect(tx, yOff - 8 * DPR, 8 * DPR, 8 * DPR);
    offCtx.fillStyle = '#475569';
    offCtx.font = `${12 * DPR}px Inter, system-ui, sans-serif`;
    offCtx.fillText(label, tx + 12 * DPR, yOff);
    yOff += 18 * DPR;
  });

  // Data source
  offCtx.fillStyle = '#94a3b8';
  offCtx.font = `${10 * DPR}px Inter, system-ui, sans-serif`;
  offCtx.fillText('Source: OpenStreetMap contributors via Overpass API', tx, H - 30 * DPR);
  offCtx.fillText(document.getElementById('data-source-line2').textContent || '', tx, H - 15 * DPR);

  off.toBlob((blob) => {
    if (!blob) { alert('Export failed — canvas may be tainted by cross-origin tiles.'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `road-orientations-${cityName.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase()}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, 'image/png');
}

document.getElementById('export-btn').addEventListener('click', exportPNG);

document.getElementById('share-btn').addEventListener('click', async () => {
  updateHash();
  const url = window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    const btn = document.getElementById('share-btn');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 2000);
  } catch {
    const fallback = document.getElementById('share-fallback');
    const input = document.getElementById('share-url-input');
    if (fallback && input) {
      fallback.hidden = false;
      input.value = url;
      input.select();
    }
  }
});