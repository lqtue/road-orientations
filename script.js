// --- Cohen-Sutherland Line Clipping ---
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

// --- Population ---
const popCache = {};
let ringPopulations = {};

// --- Ring metrics (computed from road segments) ---
let ringEntropies = [];
let ringDensities = [];
let lastMetricsKey = '';

// --- Tab state ---
let activeTab = 'roads';

function formatPop(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return Math.round(n / 1e3) + 'K';
    return String(n);
}

function fmtR(r) { return r % 1 === 0 ? r : r.toFixed(1); }

// --- Tab switching ---
function switchTab(id, btn) {
    activeTab = id;
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.viz-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + id).classList.add('active');
    document.getElementById('viz-' + id).classList.add('active');
    btn.classList.add('active');
}

// --- Population fetch ---
async function fetchRingPopulations() {
    ringPopulations = {};
    renderPeopleUI();
    const lat = pinnedCenter[1].toFixed(4);
    const lng = pinnedCenter[0].toFixed(4);
    const snapshot = [...radii];
    const maxRadius = Math.ceil(Math.max(...snapshot));
    const cacheKey = `pop:${lat},${lng},${maxRadius}`;

    let allData = popCache[cacheKey];
    if (!allData) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        try {
            const res = await fetch(
                `https://ringpopulationsapi.azurewebsites.net/api/globalringpopulations?latitude=${lat}&longitude=${lng}&distance_km=${maxRadius}`,
                { signal: controller.signal }
            );
            clearTimeout(timeoutId);
            allData = await res.json();
            popCache[cacheKey] = allData;
        } catch(e) {
            clearTimeout(timeoutId);
            console.error('Population fetch failed', e);
            snapshot.forEach(r => { ringPopulations[r] = null; });
            renderPeopleUI();
            return;
        }
    }

    snapshot.forEach(radius => {
        const target = Math.round(radius);
        const entry = Array.isArray(allData)
            ? (allData.find(d => d.distance === target) || allData.find(d => d.distance === Math.ceil(radius)))
            : null;
        ringPopulations[radius] = entry ? {
            people: entry.people,
            bus: entry.busStops || 0,
            tram: entry.tramStops || 0,
            rail: entry.railStops || 0
        } : null;
    });
    renderPeopleUI();
}

// --- POI Categories (7 essential urban service types, OSM-based) ---
const poiCategories = [
    { key: 'food',     label: 'Food & drink',  icon: '🍽', bg: '#fef3c7', color: '#f59e0b',
      test: t => (t.amenity && new Set(['restaurant','cafe','fast_food','bar','pub','food_court','ice_cream','biergarten']).has(t.amenity)) ||
                 (t.shop   && new Set(['supermarket','convenience','bakery','butcher','greengrocer','deli','marketplace']).has(t.shop)) },
    { key: 'health',   label: 'Health',         icon: '🏥', bg: '#fee2e2', color: '#f87171',
      test: t => t.amenity && new Set(['hospital','clinic','pharmacy','doctors','dentist','nursing_home']).has(t.amenity) },
    { key: 'education',label: 'Education',      icon: '🏫', bg: '#f3e8ff', color: '#a78bfa',
      test: t => t.amenity && new Set(['school','university','college','kindergarten','library']).has(t.amenity) },
    { key: 'green',    label: 'Green space',    icon: '🌳', bg: '#dcfce7', color: '#22c55e',
      test: t => t.leisure && new Set(['park','garden','nature_reserve','playground','pitch']).has(t.leisure) },
    { key: 'retail',   label: 'Retail',         icon: '🛒', bg: '#dbeafe', color: '#3b82f6',
      test: t => t.shop && !new Set(['supermarket','convenience','bakery','butcher','greengrocer','deli','marketplace','no']).has(t.shop) },
    { key: 'transit',  label: 'Transit',        icon: '🚌', bg: '#d1fae5', color: '#10b981',
      test: t => t.public_transport || t.highway === 'bus_stop' ||
                 (t.railway && new Set(['station','tram_stop','subway_entrance','halt']).has(t.railway)) },
    { key: 'active',   label: 'Active living',  icon: '⚽', bg: '#ffedd5', color: '#f97316',
      test: t => t.leisure && new Set(['fitness_centre','sports_centre','swimming_pool','track','stadium','sports_hall']).has(t.leisure) },
];

const poiCache = {};
let currentPOINodes = [];
let poiRingCounts = [];   // cached per-ring counts, recomputed when nodes change
let hoveredPOIRing = -1;
let poiAbortController = null;

// --- People canvas ---
const peopleCanvas = document.getElementById('people-canvas');
const peopleCtx = peopleCanvas.getContext('2d');
const vizH = 180;
peopleCanvas.style.width = peopleCanvas.style.height = vizH + 'px';
peopleCanvas.width = peopleCanvas.height = vizH;
if (window.devicePixelRatio > 1) {
    peopleCanvas.width = peopleCanvas.height = vizH * window.devicePixelRatio;
    peopleCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

// --- POI canvas ---
const poiCanvas = document.getElementById('poi-canvas');
const poiCtx = poiCanvas.getContext('2d');
poiCanvas.style.width = poiCanvas.style.height = vizH + 'px';
poiCanvas.width = poiCanvas.height = vizH;
if (window.devicePixelRatio > 1) {
    poiCanvas.width = poiCanvas.height = vizH * window.devicePixelRatio;
    poiCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

function drawPeopleViz() {
    const vr = vizH / 2;
    peopleCtx.clearRect(0, 0, peopleCanvas.width, peopleCanvas.height);
    const pops = radii.map(rad => ringPopulations[rad]?.people || 0);
    const maxPop = Math.max(...pops, 1);

    peopleCtx.save();
    peopleCtx.translate(vr, vr);

    // grid circles
    peopleCtx.strokeStyle = 'rgba(0,0,0,0.07)'; peopleCtx.lineWidth = 0.5;
    for (let g = 1; g <= 4; g++) {
        peopleCtx.beginPath(); peopleCtx.arc(0, 0, vr * (g / 4), 0, 2 * Math.PI); peopleCtx.stroke();
    }

    // Concentric filled discs — outermost first, innermost on top
    // radius ∝ sqrt(population) so area ∝ population
    for (let i = radii.length - 1; i >= 0; i--) {
        const pop = pops[i];
        if (!pop) continue;
        const discR = (vr - 4) * Math.sqrt(pop / maxPop);
        const color = getRingColor(i);
        const isHov = hoveredRingIndex === -1 || hoveredRingIndex === i;
        peopleCtx.beginPath();
        peopleCtx.arc(0, 0, discR, 0, 2 * Math.PI);
        peopleCtx.fillStyle = color;
        peopleCtx.globalAlpha = isHov ? (hoveredRingIndex !== -1 ? 0.75 : 0.55) : 0.12;
        peopleCtx.fill();
        peopleCtx.globalAlpha = isHov ? 0.9 : 0.2;
        peopleCtx.strokeStyle = color; peopleCtx.lineWidth = 1.5;
        peopleCtx.stroke();
    }

    peopleCtx.globalAlpha = 1;
    peopleCtx.restore();
}

function drawPOIViz() {
    const vr = vizH / 2;
    poiCtx.clearRect(0, 0, poiCanvas.width, poiCanvas.height);
    if (!poiRingCounts.length) return;

    const n = poiCategories.length;
    const angleStep = (2 * Math.PI) / n;
    const maxCount = Math.max(...poiRingCounts.flatMap(c => poiCategories.map(cat => c[cat.key])), 1);
    const plotR = vr - 22; // leave room for icons

    poiCtx.save();
    poiCtx.translate(vr, vr);

    // grid
    poiCtx.strokeStyle = 'rgba(0,0,0,0.07)'; poiCtx.lineWidth = 0.5;
    for (let g = 1; g <= 4; g++) {
        poiCtx.beginPath();
        for (let i = 0; i < n; i++) {
            const a = i * angleStep - Math.PI / 2;
            const rg = plotR * (g / 4);
            i === 0 ? poiCtx.moveTo(rg * Math.cos(a), rg * Math.sin(a))
                    : poiCtx.lineTo(rg * Math.cos(a), rg * Math.sin(a));
        }
        poiCtx.closePath(); poiCtx.stroke();
    }
    // axes
    for (let i = 0; i < n; i++) {
        const a = i * angleStep - Math.PI / 2;
        poiCtx.beginPath();
        poiCtx.moveTo(0, 0);
        poiCtx.lineTo(plotR * Math.cos(a), plotR * Math.sin(a));
        poiCtx.stroke();
    }

    // polygons — outer to inner
    for (let ri = radii.length - 1; ri >= 0; ri--) {
        const counts = poiRingCounts[ri];
        const color = getRingColor(ri);
        const isHov = hoveredRingIndex === -1 || hoveredRingIndex === ri;
        poiCtx.beginPath();
        for (let i = 0; i < n; i++) {
            const a = i * angleStep - Math.PI / 2;
            const val = counts[poiCategories[i].key];
            const pr = plotR * Math.sqrt(val / maxCount);
            i === 0 ? poiCtx.moveTo(pr * Math.cos(a), pr * Math.sin(a))
                    : poiCtx.lineTo(pr * Math.cos(a), pr * Math.sin(a));
        }
        poiCtx.closePath();
        poiCtx.fillStyle = color;
        poiCtx.globalAlpha = isHov ? (hoveredRingIndex !== -1 ? 0.5 : 0.3) : 0.06;
        poiCtx.fill();
        poiCtx.strokeStyle = color;
        poiCtx.globalAlpha = isHov ? 0.85 : 0.15;
        poiCtx.lineWidth = 1.5;
        poiCtx.stroke();
    }

    // category icons around perimeter
    poiCtx.globalAlpha = 1;
    poiCtx.font = '11px system-ui';
    poiCtx.textAlign = 'center'; poiCtx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
        const a = i * angleStep - Math.PI / 2;
        const lr = plotR + 14;
        poiCtx.fillText(poiCategories[i].icon, lr * Math.cos(a), lr * Math.sin(a));
    }

    poiCtx.globalAlpha = 1;
    poiCtx.restore();
}

async function fetchPOIData() {
    currentPOINodes = [];
    renderPOIUI();
    const [lng, lat] = pinnedCenter;
    const maxRad = radii[radii.length - 1];
    const radiusM = Math.round(maxRad * 1000);
    const cacheKey = `poi:${lat.toFixed(4)},${lng.toFixed(4)},${maxRad}`;

    let nodes = poiCache[cacheKey];
    if (!nodes) {
        if (poiAbortController) poiAbortController.abort();
        poiAbortController = new AbortController();
        const q = `[out:json][timeout:30];(
  node["amenity"](around:${radiusM},${lat},${lng});
  node["shop"](around:${radiusM},${lat},${lng});
  node["leisure"](around:${radiusM},${lat},${lng});
  node["public_transport"](around:${radiusM},${lat},${lng});
  node["highway"="bus_stop"](around:${radiusM},${lat},${lng});
  node["railway"~"station|tram_stop|subway_entrance|halt"](around:${radiusM},${lat},${lng});
);out body;`;
        try {
            const res = await fetch(
                `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`,
                { signal: poiAbortController.signal }
            );
            const data = await res.json();
            nodes = data.elements;
            poiCache[cacheKey] = nodes;
        } catch(e) {
            if (e.name !== 'AbortError') console.error('POI fetch failed', e);
            return;
        }
    }
    currentPOINodes = nodes;
    renderPOIUI();
}

function computePOICounts(ringIdx) {
    // Returns { catKey: count } cumulative within radii[ringIdx]
    const ruler = new CheapRuler(pinnedCenter[1]);
    const counts = {};
    poiCategories.forEach(c => { counts[c.key] = 0; });
    const maxDist = radii[ringIdx];
    currentPOINodes.forEach(node => {
        if (ruler.distance(pinnedCenter, [node.lon, node.lat]) > maxDist) return;
        const tags = node.tags || {};
        for (const c of poiCategories) {
            if (c.test(tags)) { counts[c.key]++; break; }
        }
    });
    return counts;
}

function renderPOIUI() {
    const vizEl = document.getElementById('poi-viz-inner');
    const ringsTbody = document.getElementById('poi-rings-tbody');
    const catList = document.getElementById('poi-category-list');

    if (!currentPOINodes.length) {
        if (vizEl) vizEl.innerHTML = '<div class="coming-soon-viz" style="padding:28px 0 8px">Fetching POI data…</div>';
        if (ringsTbody) ringsTbody.innerHTML = '';
        if (catList) catList.innerHTML = '';
        return;
    }

    const ruler = new CheapRuler(pinnedCenter[1]);

    // Compute counts per ring
    const ringCounts = radii.map((_, i) => computePOICounts(i));
    poiRingCounts = ringCounts;

    // 15-min score: categories present within ring closest to 1.2km
    const scoreIdx = radii.findIndex(r => r >= 1.2) !== -1 ? radii.findIndex(r => r >= 1.2) : 0;
    const scoreCounts = ringCounts[scoreIdx];
    const score = poiCategories.filter(c => scoreCounts[c.key] > 0).length;
    const total = Object.values(ringCounts[radii.length - 1]).reduce((s, v) => s + v, 0);
    const topCat = poiCategories.reduce((best, c) => {
        const n = ringCounts[radii.length - 1][c.key];
        return n > (ringCounts[radii.length - 1][best?.key] || 0) ? c : best;
    }, poiCategories[0]);

    // --- Viz panel ---
    if (vizEl) {
        const dots = poiCategories.map(c => {
            const has = scoreCounts[c.key] > 0;
            return `<span class="poi-dot${has ? ' filled' : ''}" title="${c.label}" style="${has ? `background:${c.color}` : ''}"></span>`;
        }).join('');

        vizEl.innerHTML = `
            <div class="poi-score-row">
                <div class="poi-score-num">${score}<span class="poi-score-denom">/7</span></div>
                <div class="poi-score-label">
                    <strong>Service access score</strong>
                    <div>Categories with ≥1 location within ${fmtR(radii[scoreIdx])} km</div>
                </div>
                <span class="tip left-align" data-tip="How many of 7 service types (food, health, education, green space, retail, transit, active living) have at least one OSM location within this radius. Binary — presence only, not count or proximity.">?</span>
            </div>
            <div class="poi-dots">${dots}</div>
            <div class="poi-caveat">Straight-line radius · not travel time</div>
            <div class="stats-row" style="margin-top:12px;">
                <div class="stat">
                    <div class="stat-label">Total POIs</div>
                    <div class="stat-value">${total.toLocaleString()}</div>
                    <div class="stat-sub">within ${fmtR(radii[radii.length-1])} km</div>
                </div>
                <div class="stat">
                    <div class="stat-label">Top category</div>
                    <div class="stat-value">${topCat.icon} ${topCat.label.split(' ')[0]}</div>
                    <div class="stat-sub">${ringCounts[radii.length-1][topCat.key].toLocaleString()} places</div>
                </div>
                <div class="stat">
                    <div class="stat-label">Score</div>
                    <div class="stat-value">${score}/7</div>
                    <div class="stat-sub">${score >= 6 ? 'excellent' : score >= 4 ? 'good' : 'limited'}</div>
                </div>
            </div>
        `;
    }

    // --- Ring table ---
    if (ringsTbody) {
        ringsTbody.innerHTML = '';
        radii.forEach((radius, i) => {
            const counts = ringCounts[i];
            const ringTotal = Object.values(counts).reduce((s, v) => s + v, 0);
            const ringScore = poiCategories.filter(c => counts[c.key] > 0).length;
            const color = getRingColor(i);
            const tr = document.createElement('tr');
            tr.style.setProperty('--rc', color);
            tr.innerHTML = `
                <td>
                    <span class="ring-swatch" style="background:${color}"></span>
                    <div class="ring-stepper">
                        <button class="step-btn" data-index="${i}" data-delta="-0.5">−</button>
                        <span class="step-val">${fmtR(radius)} km</span>
                        <button class="step-btn" data-index="${i}" data-delta="0.5">+</button>
                    </div>
                </td>
                <td><span class="metric-chip">${ringTotal.toLocaleString()}</span></td>
                <td style="text-align:right"><span class="density-val">${ringScore}/7</span></td>
            `;
            tr.querySelectorAll('.step-btn').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.dataset.index);
                    radii[idx] = Math.max(0.5, Math.min(50, radii[idx] + parseFloat(btn.dataset.delta)));
                    radii.sort((a, b) => a - b);
                    renderRadiiUI(); renderPeopleUI(); renderPOIUI(); triggerHybridAnalysis(); updateMapRings();
                };
            });
            tr.addEventListener('mouseenter', () => {
                hoveredPOIRing = i;
                setHoveredRing(i);
                renderPOICategoryList(ringCounts[i]);
            });
            tr.addEventListener('mouseleave', () => {
                hoveredPOIRing = -1;
                clearHoveredRing();
                renderPOICategoryList(ringCounts[radii.length - 1]);
            });
            ringsTbody.appendChild(tr);
        });
    }

    // Category breakdown for outermost ring by default
    renderPOICategoryList(ringCounts[radii.length - 1]);
    drawPOIViz();
}

function renderPOICategoryList(counts) {
    const catList = document.getElementById('poi-category-list');
    if (!catList) return;
    const maxCount = Math.max(...poiCategories.map(c => counts[c.key]), 1);
    catList.innerHTML = poiCategories.map(c => {
        const n = counts[c.key];
        const pct = Math.round((n / maxCount) * 100);
        return `<div class="poi-cat-row">
            <div class="poi-icon" style="background:${c.bg}">${c.icon}</div>
            <div class="poi-cat-name">${c.label}</div>
            <div class="type-bar-wrap" style="flex:1;margin:0 8px;">
                <div class="type-bar" style="width:${pct}%;background:${c.color}"></div>
            </div>
            <div class="poi-cat-count">${n.toLocaleString()}</div>
        </div>`;
    }).join('');
}

// --- Global tooltip math ---
let globalNormalizedBins = [];
let globalTypeNorms = {};

let radii = [1.0, 3.0, 5.0];
let hoveredRingIndex = -1;
let hoveredTypeKey = null;
let colorMode = 'radii';
let hoverResetTimer = null;

function setHoveredRing(i) {
    clearTimeout(hoverResetTimer);
    if (hoveredRingIndex !== i) { hoveredRingIndex = i; processAndDrawChart(); updateMapRings(); }
}
function clearHoveredRing() {
    hoverResetTimer = setTimeout(() => {
        hoveredRingIndex = -1; processAndDrawChart(); updateMapRings();
    }, 40);
}

const h = 200;
const r = h / 2;
const numBins = 64;
const ringColors = ['rgb(255, 99, 132)', 'rgb(54, 162, 235)', 'rgb(255, 206, 86)', 'rgb(75, 192, 192)', 'rgb(153, 102, 255)'];

// --- Road Type Groups ---
const roadTypeGroups = [
    { key: 'major',    label: 'Major',    color: 'rgb(220, 38, 38)',   types: new Set(['motorway','motorway_link','trunk','trunk_link','primary','primary_link']) },
    { key: 'arterial', label: 'Arterial', color: 'rgb(234, 88, 12)',   types: new Set(['secondary','secondary_link','tertiary','tertiary_link']) },
    { key: 'local',    label: 'Local',    color: 'rgb(59, 130, 246)',  types: new Set(['minor','residential','living_street','unclassified','road']) },
    { key: 'service',  label: 'Service',  color: 'rgb(100, 116, 139)', types: new Set(['service','track']) },
    { key: 'path',     label: 'Path',     color: 'rgb(22, 163, 74)',   types: new Set(['path','cycleway','footway','pedestrian','steps','bridleway']) },
];
let activeTypeGroups = new Set(roadTypeGroups.map(g => g.key));

// --- Init Map ---
const map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    center: pinnedCenter,
    zoom: 12,
    attributionControl: false
});

const centerMarker = new maplibregl.Marker({ color: '#1e293b', draggable: true })
    .setLngLat(pinnedCenter)
    .addTo(map);

// --- Search ---
let searchDebounce = null;
const searchInput = document.getElementById('search-input');
const searchResultsEl = document.getElementById('search-results');

searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = searchInput.value.trim();
    if (q.length < 2) { searchResultsEl.style.display = 'none'; return; }
    searchDebounce = setTimeout(() => fetchSearchSuggestions(q), 300);
});

searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = searchResultsEl.querySelector('.search-result-item'); if (first) first.click(); }
    if (e.key === 'Escape') searchResultsEl.style.display = 'none';
    if (e.key === 'ArrowDown') { const first = searchResultsEl.querySelector('.search-result-item'); if (first) first.focus(); e.preventDefault(); }
});

searchResultsEl.addEventListener('keydown', (e) => {
    const items = [...searchResultsEl.querySelectorAll('.search-result-item')];
    const idx = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && idx < items.length - 1) { items[idx + 1].focus(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { idx > 0 ? items[idx - 1].focus() : searchInput.focus(); e.preventDefault(); }
    if (e.key === 'Enter' && idx !== -1) { items[idx].click(); }
    if (e.key === 'Escape') { searchResultsEl.style.display = 'none'; searchInput.focus(); }
});

document.addEventListener('click', (e) => {
    if (!document.getElementById('map-search').contains(e.target)) searchResultsEl.style.display = 'none';
});

async function fetchSearchSuggestions(query) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=5`);
        const data = await res.json();
        if (data.length === 0) { searchResultsEl.style.display = 'none'; return; }
        searchResultsEl.innerHTML = '';
        data.forEach(item => {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            div.tabIndex = 0;
            div.innerHTML = `<span class="result-name">${item.display_name.split(',')[0]}</span><span class="result-detail">${item.display_name.split(',').slice(1, 3).join(',').trim()}</span>`;
            div.onclick = () => jumpToSearchResult(item);
            searchResultsEl.appendChild(div);
        });
        searchResultsEl.style.display = 'block';
    } catch(e) { console.error('Search failed', e); }
}

function jumpToSearchResult(item) {
    pinnedCenter = [parseFloat(item.lon), parseFloat(item.lat)];
    centerMarker.setLngLat(pinnedCenter);
    map.flyTo({ center: pinnedCenter, zoom: 12 });
    const name = item.display_name.split(',')[0];
    searchInput.value = name;
    document.getElementById('city-name').textContent = name;
    searchResultsEl.style.display = 'none';
    localStorage.setItem('lastCity', JSON.stringify({ name, lon: pinnedCenter[0], lat: pinnedCenter[1] }));
    updateCenterInfo();
    updateMapRings();
    triggerHybridAnalysis();
}

centerMarker.on('dragend', () => {
    const lngLat = centerMarker.getLngLat();
    pinnedCenter = [lngLat.lng, lngLat.lat];
    updateCenterInfo();
    updateMapRings();
    triggerHybridAnalysis();
});

function updateCenterInfo() {
    const el = document.getElementById('city-coords');
    if (el) el.textContent = `${pinnedCenter[1].toFixed(4)}° N, ${pinnedCenter[0].toFixed(4)}° E`;
}

// --- Basemap ---
const skipLayers = new Set(['satellite-layer', 'analysis-rings-fill', 'analysis-rings-line']);
let isSatelliteMode = false;
let satelliteHiddenLayers = [];
let vectorOpacity = 0.55;

function toggleSatellite(enabled) {
    if (!map.getLayer('satellite-layer')) return;
    map.setLayoutProperty('satellite-layer', 'visibility', enabled ? 'visible' : 'none');
    if (enabled) {
        satelliteHiddenLayers = [];
        for (const { id, type } of map.getStyle().layers) {
            if (skipLayers.has(id)) continue;
            if (type === 'background' || type === 'fill') {
                const vis = map.getLayoutProperty(id, 'visibility') ?? 'visible';
                if (vis !== 'none') { map.setLayoutProperty(id, 'visibility', 'none'); satelliteHiddenLayers.push(id); }
            } else if (type === 'line') {
                map.setPaintProperty(id, 'line-opacity', vectorOpacity);
            } else if (type === 'symbol') {
                map.setPaintProperty(id, 'text-opacity', vectorOpacity);
                map.setPaintProperty(id, 'icon-opacity', vectorOpacity);
            }
        }
    } else {
        for (const id of satelliteHiddenLayers) map.setLayoutProperty(id, 'visibility', 'visible');
        satelliteHiddenLayers = [];
        for (const { id, type } of map.getStyle().layers) {
            if (skipLayers.has(id)) continue;
            if (type === 'line') map.setPaintProperty(id, 'line-opacity', null);
            else if (type === 'symbol') {
                map.setPaintProperty(id, 'text-opacity', null);
                map.setPaintProperty(id, 'icon-opacity', null);
            }
        }
    }
}

function setBasemap(mode) {
    isSatelliteMode = (mode === 'satellite');
    document.getElementById('bm-thumb-streets').classList.toggle('active', !isSatelliteMode);
    document.getElementById('bm-thumb-satellite').classList.toggle('active', isSatelliteMode);
    document.getElementById('vec-opacity-row').style.display = isSatelliteMode ? 'flex' : 'none';
    toggleSatellite(isSatelliteMode);
}

document.getElementById('vec-opacity-slider').oninput = (e) => {
    vectorOpacity = e.target.value / 100;
    if (!isSatelliteMode) return;
    for (const { id, type } of map.getStyle().layers) {
        if (skipLayers.has(id)) continue;
        if (type === 'line') map.setPaintProperty(id, 'line-opacity', vectorOpacity);
        else if (type === 'symbol') {
            map.setPaintProperty(id, 'text-opacity', vectorOpacity);
            map.setPaintProperty(id, 'icon-opacity', vectorOpacity);
        }
    }
};

// --- Panel resize ---
(function() {
    const resizer = document.getElementById('panel-resizer');
    const panel = document.getElementById('panel');
    let startX, startW;
    resizer.addEventListener('mousedown', (e) => {
        startX = e.clientX;
        startW = panel.offsetWidth;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        function onMove(e) {
            const dx = startX - e.clientX; // panel is on the right
            const newW = Math.min(600, Math.max(280, startW + dx));
            panel.style.width = newW + 'px';
        }
        function onUp() {
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
})();

// Basemap toggle — click to open/close
document.querySelector('.basemap-toggle').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('basemap-float').classList.toggle('open');
});
document.addEventListener('click', (e) => {
    if (!document.getElementById('basemap-float').contains(e.target)) {
        document.getElementById('basemap-float').classList.remove('open');
    }
});

// Attribution
const attrToggle = document.getElementById('attr-toggle');
const attrText = document.getElementById('attr-text');
attrToggle.onclick = () => { attrText.style.display = attrText.style.display === 'block' ? 'none' : 'block'; };
document.addEventListener('click', (e) => {
    if (!document.getElementById('map-attribution').contains(e.target)) attrText.style.display = 'none';
});

// Share button — copy current URL
document.getElementById('share-btn').onclick = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
        const btn = document.getElementById('share-btn');
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = '⤴'; }, 1500);
    });
};

// --- Color mode ---
function setRoadTypeSection(visible) {
    document.getElementById('road-type-section').style.display = visible ? '' : 'none';
}
document.getElementById('color-mode-radii').onclick = () => {
    colorMode = 'radii';
    document.getElementById('color-mode-radii').classList.add('active');
    document.getElementById('color-mode-type').classList.remove('active');
    setRoadTypeSection(false);
    hoveredRingIndex = -1; processAndDrawChart(); updateMapRings();
};
document.getElementById('color-mode-type').onclick = () => {
    colorMode = 'type';
    document.getElementById('color-mode-type').classList.add('active');
    document.getElementById('color-mode-radii').classList.remove('active');
    setRoadTypeSection(true);
    hoveredRingIndex = -1; processAndDrawChart(); updateMapRings();
};

function getRingColor(i) { return ringColors[i % ringColors.length]; }

// --- Render rings table (Roads tab) ---
function renderRadiiUI() {
    const tbody = document.getElementById('rings-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    radii.forEach((radius, i) => {
        const ent = ringEntropies[i];
        const den = ringDensities[i];
        const color = getRingColor(i);
        const tr = document.createElement('tr');
        tr.style.setProperty('--rc', color);
        tr.innerHTML = `
            <td>
                <span class="ring-swatch" style="background:${color}"></span>
                <div class="ring-stepper">
                    <button class="step-btn" data-index="${i}" data-delta="-0.5">−</button>
                    <span class="step-val">${fmtR(radius)} km</span>
                    <button class="step-btn" data-index="${i}" data-delta="0.5">+</button>
                </div>
            </td>
            <td><span class="metric-chip">${ent !== undefined ? ent.toFixed(2) : '—'}</span></td>
            <td><span class="density-val">${den !== undefined ? den.toFixed(1) : '—'}</span></td>
            <td><button class="remove-btn" data-index="${i}">×</button></td>
        `;

        tr.addEventListener('mouseenter', () => setHoveredRing(i));
        tr.addEventListener('mouseleave', clearHoveredRing);
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.step-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const i = parseInt(btn.dataset.index);
            const delta = parseFloat(btn.dataset.delta);
            radii[i] = Math.max(0.5, Math.min(50, radii[i] + delta));
            radii.sort((a, b) => a - b);
            renderRadiiUI(); triggerHybridAnalysis(); updateMapRings();
        };
    });

    tbody.querySelectorAll('.remove-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const i = parseInt(btn.dataset.index);
            if (radii.length > 1) {
                radii.splice(i, 1);
                hoveredRingIndex = -1;
                renderRadiiUI(); triggerHybridAnalysis(); updateMapRings();
            }
        };
    });

    const addBtn = document.getElementById('add-radius-btn');
    if (addBtn) addBtn.disabled = radii.length >= 5;
}

// --- Render people tab ---
function renderPeopleUI() {
    // Pop bars in viz-people
    const popBarsEl = document.getElementById('pop-bars');
    if (popBarsEl) {
        const pops = radii.map(r => { const p = ringPopulations[r]; return p ? p.people : 0; });
        const maxPop = Math.max(...pops, 1);
        popBarsEl.innerHTML = radii.map((radius, i) => {
            const p = ringPopulations[radius];
            const color = getRingColor(i);
            const pop = p ? p.people : null;
            const pct = pop ? Math.round((pop / maxPop) * 100) : 0;
            const label = pop !== null ? (pop !== undefined ? formatPop(pop) : '…') : (p === undefined ? '…' : 'N/A');
            return `<div class="pop-bar-row">
                <div class="pop-bar-label" style="color:${color}">${fmtR(radius)} km</div>
                <div class="pop-bar-track"><div class="pop-bar-fill" style="width:${pct}%;background:${color}"></div></div>
                <div class="pop-bar-val">${label}</div>
            </div>`;
        }).join('');
    }

    // People table — same ring row structure as Roads tab
    const peopleTbody = document.getElementById('people-tbody');
    if (peopleTbody) {
        peopleTbody.innerHTML = '';
        radii.forEach((radius, i) => {
            const p = ringPopulations[radius];
            const color = getRingColor(i);
            const popStr = p === undefined ? '…' : (p === null ? 'N/A' : formatPop(p.people));
            const transitMain = p ? `${p.bus}🚌 · ${p.tram}🚋 · ${p.rail}🚆` : '—';
            const bus100k = p && p.people > 0 ? ((p.bus / p.people) * 100000).toFixed(1) : null;
            const rail100k = p && p.people > 0 ? (((p.rail + p.tram) / p.people) * 100000).toFixed(1) : null;
            const transitSub = bus100k ? `${bus100k} bus · ${rail100k} rail per 100K` : '';

            const tr = document.createElement('tr');
            tr.style.setProperty('--rc', color);
            tr.innerHTML = `
                <td>
                    <span class="ring-swatch" style="background:${color}"></span>
                    <div class="ring-stepper">
                        <button class="step-btn" data-index="${i}" data-delta="-0.5">−</button>
                        <span class="step-val">${fmtR(radius)} km</span>
                        <button class="step-btn" data-index="${i}" data-delta="0.5">+</button>
                    </div>
                </td>
                <td>
                    <span class="metric-chip">${popStr}</span>
                </td>
                <td style="text-align:right">
                    <span class="density-val">${transitMain}</span>
                    ${transitSub ? `<div class="ring-sub">${transitSub}</div>` : ''}
                </td>
            `;

            tr.querySelectorAll('.step-btn').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.dataset.index);
                    const delta = parseFloat(btn.dataset.delta);
                    radii[idx] = Math.max(0.5, Math.min(50, radii[idx] + delta));
                    radii.sort((a, b) => a - b);
                    renderRadiiUI(); renderPeopleUI(); triggerHybridAnalysis(); updateMapRings();
                };
            });

            tr.addEventListener('mouseenter', () => setHoveredRing(i));
            tr.addEventListener('mouseleave', clearHoveredRing);
            peopleTbody.appendChild(tr);
        });
    }

    // People stats
    const outerPop = ringPopulations[radii[radii.length - 1]];
    const outerRadius = radii[radii.length - 1];
    const popTotalEl = document.getElementById('stat-pop-total');
    const popRangeEl = document.getElementById('stat-pop-range');
    const transitEl = document.getElementById('stat-transit');
    const popDensityEl = document.getElementById('stat-pop-density');

    if (outerPop && outerPop.people) {
        if (popTotalEl) popTotalEl.textContent = formatPop(outerPop.people);
        if (popRangeEl) popRangeEl.textContent = `within ${fmtR(outerRadius)} km`;
        const area = Math.PI * outerRadius * outerRadius;
        if (popDensityEl) popDensityEl.textContent = Math.round(outerPop.people / area).toLocaleString();
        const stopsAll = outerPop.bus + outerPop.rail + outerPop.tram;
        if (transitEl) transitEl.textContent = outerPop.people > 0 ? ((stopsAll / outerPop.people) * 100000).toFixed(1) : '—';
    } else {
        if (popTotalEl) popTotalEl.textContent = outerPop === undefined ? '…' : '—';
        if (transitEl) transitEl.textContent = '—';
        if (popDensityEl) popDensityEl.textContent = '—';
    }
    drawPeopleViz();
}

// --- Render road type bars ---
function renderRoadTypeUI() {
    const container = document.getElementById('road-type-list');
    if (!container) return;

    const ruler = new CheapRuler(pinnedCenter[1]);
    const typeLengths = {};
    roadTypeGroups.forEach(g => { typeLengths[g.key] = 0; });
    const maxRad = radii[radii.length - 1];

    if (currentSegments.length > 0) {
        currentSegments.forEach(seg => {
            const mid = [(seg.p1[0] + seg.p2[0]) / 2, (seg.p1[1] + seg.p2[1]) / 2];
            if (ruler.distance(pinnedCenter, mid) > maxRad) return;
            const hw = seg.highway || '';
            const len = ruler.distance(seg.p1, seg.p2);
            for (const g of roadTypeGroups) { if (g.types.has(hw)) { typeLengths[g.key] += len; break; } }
        });
    }

    const total = Object.values(typeLengths).reduce((s, v) => s + v, 0);
    container.innerHTML = '';
    roadTypeGroups.forEach(g => {
        const pct = total > 0 ? Math.round((typeLengths[g.key] / total) * 100) : 0;
        const isOn = activeTypeGroups.has(g.key);
        const row = document.createElement('div');
        row.className = 'type-row' + (isOn ? '' : ' inactive');
        row.dataset.key = g.key;
        row.innerHTML = `
            <button class="type-toggle${isOn ? ' on' : ''}" style="--c:${g.color}" title="${isOn ? 'Hide' : 'Show'} on chart &amp; map"></button>
            <div class="type-label">${g.label}</div>
            <div class="type-bar-wrap"><div class="type-bar" style="width:${pct}%;background:${g.color}"></div></div>
            <div class="type-pct">${pct}%</div>
        `;
        row.querySelector('.type-toggle').addEventListener('click', (e) => {
            e.stopPropagation();
            if (activeTypeGroups.has(g.key)) {
                if (activeTypeGroups.size > 1) activeTypeGroups.delete(g.key);
            } else {
                activeTypeGroups.add(g.key);
            }
            renderRoadTypeUI();
            processAndDrawChart();
        });
        row.addEventListener('mouseenter', () => {
            if (!activeTypeGroups.has(g.key)) return;
            hoveredTypeKey = g.key;
            row.style.borderLeftColor = g.color;
            processAndDrawChart();
        });
        row.addEventListener('mouseleave', () => {
            hoveredTypeKey = null;
            row.style.borderLeftColor = 'transparent';
            processAndDrawChart();
        });
        container.appendChild(row);
    });
}


// --- Update road stats (dominant, entropy, density) ---
function updateRoadsStats() {
    const outerIdx = radii.length - 1;
    const ent = ringEntropies[outerIdx];
    const den = ringDensities[outerIdx];

    const entEl = document.getElementById('stat-entropy');
    const entLabelEl = document.getElementById('stat-entropy-label');
    const denEl = document.getElementById('stat-density');
    const domEl = document.getElementById('stat-dominant');
    const domDegEl = document.getElementById('stat-dominant-deg');

    if (ent !== undefined) {
        if (entEl) entEl.textContent = ent.toFixed(2);
        if (entLabelEl) entLabelEl.textContent = ent < 0.5 ? 'grid' : ent < 0.8 ? 'mixed' : 'organic';
    }
    if (den !== undefined && denEl) denEl.textContent = den.toFixed(1);

    if (globalNormalizedBins.length > 0) {
        const outerBins = globalNormalizedBins[Math.min(outerIdx, globalNormalizedBins.length - 1)];
        let maxBin = 0, maxVal = 0;
        for (let b = 0; b < numBins; b++) { if (outerBins[b] > maxVal) { maxVal = outerBins[b]; maxBin = b; } }
        const deg = Math.round(maxBin * 360 / numBins);
        const oppDeg = (deg + 180) % 360;
        if (domEl) domEl.textContent = `${getCompassDirection(deg)}–${getCompassDirection(oppDeg)}`;
        if (domDegEl) domDegEl.textContent = `~${deg}°`;
    }
}

// --- Status badge ---
function updateStatus(state) {
    const el = document.getElementById('data-status');
    if (!el) return;
    el.className = `data-badge ${state}`;
    if (state === 'fast')     { el.textContent = 'FAST'; el.onclick = null; el.style.cursor = ''; }
    if (state === 'fetching') { el.textContent = 'FETCHING…'; el.onclick = null; el.style.cursor = ''; }
    if (state === 'precise')  { el.textContent = 'PRECISE'; el.onclick = null; el.style.cursor = ''; }
    if (state === 'error')    {
        el.textContent = 'ERROR — RETRY';
        el.style.cursor = 'pointer';
        el.onclick = () => { el.onclick = null; triggerHybridAnalysis(); };
    }
}

// --- Add ring ---
document.getElementById('add-radius-btn').onclick = () => {
    if (radii.length >= 5) return;
    const next = Math.min(50, radii[radii.length - 1] + 2.0);
    if (next === radii[radii.length - 1]) return;
    radii.push(next); renderRadiiUI(); triggerHybridAnalysis(); updateMapRings();
};

// --- Hybrid Data Engine ---
function extractLocalSegments() {
    const bounds = map.getBounds();
    const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
    const seen = new Set();
    const features = map.queryRenderedFeatures().filter(f => {
        if (!f.geometry || !(f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')) return false;
        if (!f.layer?.['source-layer'] || (f.layer['source-layer'] !== 'street' && f.layer['source-layer'] !== 'transportation')) return false;
        // Deduplicate: same road appears once per style layer; use feature ID if available
        if (f.id != null) {
            const uid = String(f.id);
            if (seen.has(uid)) return false;
            seen.add(uid);
        }
        return true;
    });
    const segments = [];
    features.forEach(f => {
        const isTwoWay = f.properties.oneway !== 'yes' && f.properties.oneway !== 1 && f.properties.oneway !== true;
        const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
        lines.forEach(line => {
            const clipped = lineclip(line, bbox);
            clipped.forEach(clipLine => {
                const hw = f.properties.class || f.properties.type || '';
                for (let i = 0; i < clipLine.length - 1; i++) {
                    segments.push({ p1: clipLine[i], p2: clipLine[i+1], isTwoWay, highway: hw });
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
                const highway = (el.tags && el.tags.highway) || '';
                for (let i = 0; i < coords.length - 1; i++) {
                    segments.push({ p1: coords[i], p2: coords[i+1], isTwoWay, highway });
                }
            }
        });
        dataCache[cacheKey] = segments;
        return segments;
    } catch (error) {
        if (error.name === 'AbortError') console.log('Previous fetch cancelled');
        else { console.error("Overpass fetch failed:", error); updateStatus('error'); }
        return null;
    }
}

async function triggerHybridAnalysis() {
    currentSegments = extractLocalSegments();
    updateStatus('fast');
    processAndDrawChart();
    fetchRingPopulations();
    const fetchRadius = radii[radii.length - 1] + 1;
    const preciseSegments = await fetchOverpassSegments(pinnedCenter, fetchRadius);
    if (preciseSegments) {
        currentSegments = preciseSegments;
        updateStatus('precise');
        processAndDrawChart();
    }
    fetchPOIData();
}

// --- Canvas setup ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
canvas.style.width = canvas.style.height = h + 'px';
canvas.width = canvas.height = h;
if (window.devicePixelRatio > 1) { canvas.width = canvas.height = h * 2; ctx.scale(2, 2); }

// --- Main chart drawing ---
function processAndDrawChart() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const bearing = map.getBearing();
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(-bearing * Math.PI / 180);

    ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.5; ctx.beginPath();
    ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke();

    if (!currentSegments || currentSegments.length === 0) { ctx.restore(); updateRoadsStats(); return; }

    const ruler = new CheapRuler(pinnedCenter[1]);

    // --- Compute ring metrics (entropy + street density) ---
    {
        const mBins = Array.from({ length: radii.length }, () => new Float64Array(numBins));
        const mLen = new Float64Array(radii.length);
        const mLenPhys = new Float64Array(radii.length);
        const maxRad = radii[radii.length - 1];
        const filterByType = colorMode === 'type';
        currentSegments.forEach(seg => {
            if (filterByType) {
                const hw = seg.highway || '';
                let active = false;
                for (const g of roadTypeGroups) { if (g.types.has(hw) && activeTypeGroups.has(g.key)) { active = true; break; } }
                if (!active) return;
            }
            const mid = [(seg.p1[0] + seg.p2[0]) / 2, (seg.p1[1] + seg.p2[1]) / 2];
            const dist = ruler.distance(pinnedCenter, mid);
            if (dist > maxRad) return;
            let ri = 0;
            for (let rIdx = 0; rIdx < radii.length; rIdx++) { if (dist <= radii[rIdx]) { ri = rIdx; break; } }
            const len = ruler.distance(seg.p1, seg.p2);
            // Use undirected bearing (0–180°): a road at 45° and 225° are the same orientation
            const brg = ruler.bearing(seg.p1, seg.p2);
            const undirected = ((brg % 180) + 180) % 180;
            const b0 = Math.round(undirected * numBins / 180) % numBins;
            mBins[ri][b0] += len; mLen[ri] += len; mLenPhys[ri] += len;
        });
        const cumBins = new Float64Array(numBins);
        let cumLenPhys = 0;
        const newEntropies = [], newDensities = [];
        for (let i = 0; i < radii.length; i++) {
            for (let b = 0; b < numBins; b++) cumBins[b] += mBins[i][b];
            cumLenPhys += mLenPhys[i];
            const tot = cumBins.reduce((s, v) => s + v, 0);
            let H = 0;
            if (tot > 0) {
                for (let b = 0; b < numBins; b++) {
                    if (cumBins[b] > 0) { const p = cumBins[b] / tot; H -= p * Math.log2(p); }
                }
                H /= Math.log2(numBins);
            }
            newEntropies.push(H);
            const area = Math.PI * radii[i] * radii[i];
            newDensities.push(area > 0 ? cumLenPhys / area : 0);
        }
        const filterSuffix = colorMode === 'type' ? '|' + [...activeTypeGroups].sort().join('+') : '';
        const key = newEntropies.map(e => e.toFixed(3)).join(',') + filterSuffix;
        if (key !== lastMetricsKey) {
            lastMetricsKey = key;
            ringEntropies = newEntropies;
            ringDensities = newDensities;
            renderRadiiUI();
            renderRoadTypeUI();
        }
    }

    if (colorMode === 'radii' && !hoveredTypeKey) {
        const stackedBins = Array.from({ length: radii.length }, () => new Float64Array(numBins));
        const maxRadius = radii[radii.length - 1];
        currentSegments.forEach(seg => {
            const midPt = [(seg.p1[0] + seg.p2[0]) / 2, (seg.p1[1] + seg.p2[1]) / 2];
            const distToCenter = ruler.distance(pinnedCenter, midPt);
            if (distToCenter > maxRadius) return;
            let ringIndex = 0;
            for (let rIdx = 0; rIdx < radii.length; rIdx++) { if (distToCenter <= radii[rIdx]) { ringIndex = rIdx; break; } }
            const segBearing = ruler.bearing(seg.p1, seg.p2);
            const distance = ruler.distance(seg.p1, seg.p2);
            const k0 = Math.round((segBearing + 360) * numBins / 360) % numBins;
            const k1 = Math.round((segBearing + 180) * numBins / 360) % numBins;
            stackedBins[ringIndex][k0] += distance;
            if (seg.isTwoWay) stackedBins[ringIndex][k1] += distance;
        });

        const ringTotals = new Float64Array(radii.length);
        for (let ring = 0; ring < radii.length; ring++)
            for (let b = 0; b < numBins; b++) ringTotals[ring] += stackedBins[ring][b];

        let maxPercentage = 0;
        globalNormalizedBins = Array.from({ length: radii.length }, () => new Float64Array(numBins));
        const cumulativeTotals = new Float64Array(radii.length);
        for (let ring = 0; ring < radii.length; ring++)
            for (let b = 0; b < numBins; b++)
                for (let k = 0; k <= ring; k++) cumulativeTotals[ring] += stackedBins[k][b];
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

        if (maxPercentage === 0) { ctx.restore(); updateRoadsStats(); return; }

        ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 0.5;
        for (let g = 1; g <= 4; g++) {
            ctx.beginPath(); ctx.arc(0, 0, r * Math.sqrt(g / 4), 0, 2 * Math.PI, false); ctx.stroke();
        }

        const ringsToDraw = [];
        for (let i = radii.length - 1; i >= 0; i--) if (i !== hoveredRingIndex) ringsToDraw.push(i);
        if (hoveredRingIndex !== -1 && hoveredRingIndex < radii.length) ringsToDraw.push(hoveredRingIndex);

        for (const ring of ringsToDraw) {
            if (ringTotals[ring] === 0) continue;
            const isHovered = hoveredRingIndex === -1 || hoveredRingIndex === ring;
            ctx.fillStyle = getRingColor(ring);
            ctx.globalAlpha = isHovered ? (hoveredRingIndex !== -1 ? 0.85 : 0.6) : 0.1;
            ctx.beginPath(); ctx.moveTo(0, 0);
            for (let b = 0; b < numBins; b++) {
                const a0 = ((b - 0.5) * 360 / numBins - 90) * Math.PI / 180;
                const a1 = ((b + 0.5) * 360 / numBins - 90) * Math.PI / 180;
                const pct = globalNormalizedBins[ring][b];
                if (pct > 0) { ctx.arc(0, 0, r * Math.sqrt(pct / maxPercentage), a0, a1, false); ctx.lineTo(0, 0); }
            }
            ctx.fill();
            ctx.globalAlpha = isHovered ? 1.0 : 0.2;
            ctx.strokeStyle = getRingColor(ring); ctx.lineWidth = 1.0; ctx.stroke();
        }

    } else {
        const stackedTypeBins = {};
        roadTypeGroups.forEach(g => {
            if (activeTypeGroups.has(g.key))
                stackedTypeBins[g.key] = Array.from({ length: radii.length }, () => new Float64Array(numBins));
        });
        const outerRadius = radii[radii.length - 1];
        currentSegments.forEach(seg => {
            const midPt = [(seg.p1[0] + seg.p2[0]) / 2, (seg.p1[1] + seg.p2[1]) / 2];
            const distToCenter = ruler.distance(pinnedCenter, midPt);
            if (distToCenter > outerRadius) return;
            let ringIndex = 0;
            for (let rIdx = 0; rIdx < radii.length; rIdx++) { if (distToCenter <= radii[rIdx]) { ringIndex = rIdx; break; } }
            const hw = seg.highway || '';
            let groupKey = null;
            for (const g of roadTypeGroups) { if (g.types.has(hw)) { groupKey = g.key; break; } }
            if (!groupKey || !activeTypeGroups.has(groupKey)) return;
            const bins = stackedTypeBins[groupKey][ringIndex];
            const segBearing = ruler.bearing(seg.p1, seg.p2);
            const distance = ruler.distance(seg.p1, seg.p2);
            const k0 = Math.round((segBearing + 360) * numBins / 360) % numBins;
            const k1 = Math.round((segBearing + 180) * numBins / 360) % numBins;
            bins[k0] += distance;
            if (seg.isTwoWay) bins[k1] += distance;
        });

        let total = 0;
        roadTypeGroups.forEach(g => {
            if (!stackedTypeBins[g.key]) return;
            for (let ring = 0; ring < radii.length; ring++)
                for (let b = 0; b < numBins; b++) total += stackedTypeBins[g.key][ring][b];
        });
        if (total === 0) { ctx.restore(); updateRoadsStats(); return; }

        const normTypeBins = {};
        let maxPercentage = 0;
        roadTypeGroups.forEach(g => {
            if (!stackedTypeBins[g.key]) return;
            normTypeBins[g.key] = Array.from({ length: radii.length }, () => new Float64Array(numBins));
            for (let ring = 0; ring < radii.length; ring++) {
                for (let b = 0; b < numBins; b++) {
                    let cumVal = 0;
                    for (let k = 0; k <= ring; k++) cumVal += stackedTypeBins[g.key][k][b];
                    const pct = (cumVal / total) * 100;
                    normTypeBins[g.key][ring][b] = pct;
                    if (pct > maxPercentage) maxPercentage = pct;
                }
            }
        });
        if (maxPercentage === 0) { ctx.restore(); updateRoadsStats(); return; }

        maxPercentage = 0;
        for (let ring = 0; ring < radii.length; ring++) {
            for (let b = 0; b < numBins; b++) {
                let binTotal = 0;
                roadTypeGroups.forEach(g => { if (activeTypeGroups.has(g.key) && normTypeBins[g.key]) binTotal += normTypeBins[g.key][ring][b]; });
                if (binTotal > maxPercentage) maxPercentage = binTotal;
            }
        }
        if (maxPercentage === 0) { ctx.restore(); updateRoadsStats(); return; }

        const tooltipRing = hoveredRingIndex !== -1 ? hoveredRingIndex : radii.length - 1;
        globalTypeNorms = {};
        roadTypeGroups.forEach(g => { if (normTypeBins[g.key]) globalTypeNorms[g.key] = normTypeBins[g.key][tooltipRing]; });

        ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 0.5;
        for (let g = 1; g <= 4; g++) {
            ctx.beginPath(); ctx.arc(0, 0, r * Math.sqrt(g / 4), 0, 2 * Math.PI, false); ctx.stroke();
        }

        const stackOrder = ['major', 'arterial', 'local', 'service', 'path'];
        function drawStackedBins(ring, alpha) {
            for (let b = 0; b < numBins; b++) {
                const a0 = ((b - 0.5) * 360 / numBins - 90) * Math.PI / 180;
                const a1 = ((b + 0.5) * 360 / numBins - 90) * Math.PI / 180;
                let cumulative = 0;
                for (const key of stackOrder) {
                    const g = roadTypeGroups.find(g => g.key === key);
                    if (!g || !activeTypeGroups.has(key) || !normTypeBins[key]) continue;
                    const pct = normTypeBins[key][ring][b];
                    if (pct <= 0) continue;
                    const innerR = cumulative > 0 ? r * Math.sqrt(cumulative / maxPercentage) : 0;
                    const outerR = r * Math.sqrt((cumulative + pct) / maxPercentage);
                    // Dim non-hovered types when a type is hovered
                    const typeAlpha = hoveredTypeKey ? (key === hoveredTypeKey ? alpha : alpha * 0.1) : alpha;
                    ctx.globalAlpha = typeAlpha;
                    ctx.fillStyle = g.color;
                    ctx.beginPath();
                    ctx.arc(0, 0, outerR, a0, a1);
                    ctx.arc(0, 0, innerR, a1, a0, true);
                    ctx.closePath();
                    ctx.fill();
                    cumulative += pct;
                }
            }
        }

        if (hoveredRingIndex === -1) {
            for (let ring = radii.length - 1; ring >= 0; ring--) {
                const t = radii.length === 1 ? 1 : (radii.length - 1 - ring) / (radii.length - 1);
                drawStackedBins(ring, hoveredTypeKey ? 0.85 : 0.5 + t * 0.35);
            }
        } else {
            for (let ring = radii.length - 1; ring >= 0; ring--)
                if (ring !== hoveredRingIndex) drawStackedBins(ring, 0.1);
            drawStackedBins(hoveredRingIndex, 0.85);
        }
    }

    ctx.globalAlpha = 1.0; ctx.restore();
    updateRoadsStats();
    drawPeopleViz();
    drawPOIViz();
}

// --- Map Ring Geometries ---
function updateMapRings() {
    if (!map.isStyleLoaded()) return;
    const features = [];
    for (let i = radii.length - 1; i >= 0; i--) {
        const radius = radii[i];
        const outerCircle = turf.circle(pinnedCenter, radius, { steps: 64, units: 'kilometers' });
        features.push(turf.polygon([outerCircle.geometry.coordinates[0]], {
            ringIndex: i, color: getRingColor(i),
            fillOpacity: Math.max(0.02, hoveredRingIndex === -1 ? 0.15 : (hoveredRingIndex === i ? 0.3 : 0.05)),
            lineOpacity: Math.max(0.05, hoveredRingIndex === -1 ? 0.8 : (hoveredRingIndex === i ? 1.0 : 0.1))
        }));
    }
    const geojson = { type: "FeatureCollection", features };
    if (map.getSource('analysis-rings')) { map.getSource('analysis-rings').setData(geojson); }
    else {
        map.addSource('analysis-rings', { type: 'geojson', data: geojson });
        map.addLayer({ id: 'analysis-rings-fill', type: 'fill', source: 'analysis-rings', paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': ['get', 'fillOpacity'],
            'fill-opacity-transition': { duration: 150, delay: 0 }
        }});
        map.addLayer({ id: 'analysis-rings-line', type: 'line', source: 'analysis-rings', paint: {
            'line-color': ['get', 'color'],
            'line-width': 2,
            'line-opacity': ['get', 'lineOpacity'],
            'line-opacity-transition': { duration: 150, delay: 0 },
            'line-dasharray': [2, 2]
        }});
    }
}

// --- Compass helper ---
function getCompassDirection(degrees) {
    const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    const index = Math.round(((degrees %= 360) < 0 ? degrees + 360 : degrees) / 22.5) % 16;
    return dirs[index];
}

function hideTooltip() { document.getElementById('chart-tooltip').style.display = 'none'; }

// --- Map load ---
map.on('load', async () => {
    const firstStyleLayerId = map.getStyle().layers[0]?.id;
    map.addSource('satellite', {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256, attribution: '© Esri, Maxar, Earthstar Geographics'
    });
    map.addLayer({ id: 'satellite-layer', type: 'raster', source: 'satellite', layout: { visibility: 'none' } }, firstStyleLayerId);

    updateCenterInfo(); renderRadiiUI(); renderPeopleUI(); renderPOIUI(); renderRoadTypeUI();
    setTimeout(() => { triggerHybridAnalysis(); }, 400);

    // Restore last city or default to HCMC
    const saved = (() => { try { return JSON.parse(localStorage.getItem('lastCity')); } catch { return null; } })();
    if (saved) {
        pinnedCenter = [saved.lon, saved.lat];
        centerMarker.setLngLat(pinnedCenter);
        map.setCenter(pinnedCenter);
        searchInput.value = saved.name;
        document.getElementById('city-name').textContent = saved.name;
        updateCenterInfo(); updateMapRings(); triggerHybridAnalysis();
    } else {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent('Ho Chi Minh City, Vietnam')}&format=json&limit=1`);
            const data = await res.json();
            if (data.length > 0) {
                pinnedCenter = [parseFloat(data[0].lon), parseFloat(data[0].lat)];
                centerMarker.setLngLat(pinnedCenter);
                map.setCenter(pinnedCenter);
                searchInput.value = 'Ho Chi Minh City';
                document.getElementById('city-name').textContent = 'Ho Chi Minh City';
                updateCenterInfo();
            }
        } catch(e) { console.error('Initial geocode failed', e); }
    }

    map.on('mousemove', 'analysis-rings-fill', (e) => {
        if (e.features.length > 0) {
            map.getCanvas().style.cursor = 'pointer';
            setHoveredRing(e.features[0].properties.ringIndex);
        }
    });
    map.on('mouseleave', 'analysis-rings-fill', () => {
        map.getCanvas().style.cursor = '';
        clearHoveredRing();
    });
});

map.on('moveend', () => {
    if (document.getElementById('data-status').className.includes('fast')) {
        currentSegments = extractLocalSegments();
        processAndDrawChart();
    }
});

// --- Canvas hover & tooltips ---
const canvasContainer = document.getElementById('canvas-container');
const tooltip = document.getElementById('chart-tooltip');

canvasContainer.addEventListener('mousemove', (e) => {
    const rect = canvasContainer.getBoundingClientRect();
    const mx = e.clientX - rect.left - rect.width / 2;
    const my = e.clientY - rect.top - rect.height / 2;
    const dist = Math.sqrt(mx*mx + my*my);
    const effectiveR = rect.width / 2 - 6; // subtract padding

    if (dist > effectiveR) {
        if (colorMode === 'radii' && hoveredRingIndex !== -1) {
            hoveredRingIndex = -1; processAndDrawChart(); updateMapRings();
        }
        hideTooltip(); return;
    }

    let angleDeg = (Math.atan2(my, mx) * 180 / Math.PI) + 90 + map.getBearing();
    angleDeg = (angleDeg % 360 + 360) % 360;
    const binIndex = Math.round(angleDeg * numBins / 360) % numBins;
    const compassDir = getCompassDirection(angleDeg);

    if (colorMode === 'radii') {
        const bestRing = Math.min(Math.floor((dist / effectiveR) * radii.length), radii.length - 1);
        setHoveredRing(bestRing);
        if (globalNormalizedBins.length > 0 && hoveredRingIndex !== -1) {
            const pct = globalNormalizedBins[hoveredRingIndex][binIndex];
            const color = getRingColor(hoveredRingIndex);
            tooltip.style.display = 'block';
            tooltip.style.left = e.clientX + 'px';
            tooltip.style.top = e.clientY + 'px';
            tooltip.innerHTML = `
                <div style="display:flex;align-items:center;">
                    <span class="tooltip-dot" style="background:${color}"></span>
                    <span style="color:#94a3b8;">${fmtR(radii[hoveredRingIndex])} km ring</span>
                </div>
                <div class="tooltip-val">${compassDir} (${Math.round(angleDeg)}°)</div>
                <div style="font-size:0.85rem;color:#cbd5e1;margin-top:4px;">${pct.toFixed(2)}% of road length</div>
            `;
        }
    } else {
        if (Object.keys(globalTypeNorms).length === 0) return;
        const topTypes = roadTypeGroups
            .filter(g => activeTypeGroups.has(g.key) && globalTypeNorms[g.key])
            .map(g => ({ label: g.label, color: g.color, pct: globalTypeNorms[g.key][binIndex] }))
            .filter(e => e.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 4);
        if (topTypes.length === 0) { hideTooltip(); return; }
        const rangeLabel = hoveredRingIndex !== -1 ? ` · within ${fmtR(radii[hoveredRingIndex])} km` : '';
        tooltip.style.display = 'block';
        tooltip.style.left = e.clientX + 'px';
        tooltip.style.top = e.clientY + 'px';
        tooltip.innerHTML = `
            <div style="color:#94a3b8;font-size:0.75rem;margin-bottom:5px;">${compassDir} (${Math.round(angleDeg)}°)${rangeLabel}</div>
            ${topTypes.map(t => `<div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
                <span class="tooltip-dot" style="background:${t.color}"></span>
                <span>${t.label}: <strong>${t.pct.toFixed(1)}%</strong></span>
            </div>`).join('')}
        `;
    }
});

canvasContainer.addEventListener('mouseleave', () => {
    if (colorMode === 'radii') clearHoveredRing();
    hideTooltip();
});

// --- CSV Export ---
function exportCSV() {
    const cityName = searchInput.value.trim() || 'unknown';
    const rows = [];
    if (colorMode === 'radii') {
        if (!globalNormalizedBins.length) return;
        rows.push(['bearing_deg', 'compass', ...radii.map(r => `pct_within_${r}km`)]);
        for (let b = 0; b < numBins; b++) {
            const deg = Math.round(b * 360 / numBins);
            rows.push([deg, getCompassDirection(deg), ...radii.map((_, ring) => (globalNormalizedBins[ring]?.[b] ?? 0).toFixed(4))]);
        }
    } else {
        if (!Object.keys(globalTypeNorms).length) return;
        const activeKeys = roadTypeGroups.filter(g => activeTypeGroups.has(g.key) && globalTypeNorms[g.key]);
        rows.push(['bearing_deg', 'compass', ...activeKeys.map(g => `pct_${g.key}`)]);
        for (let b = 0; b < numBins; b++) {
            const deg = Math.round(b * 360 / numBins);
            rows.push([deg, getCompassDirection(deg), ...activeKeys.map(g => (globalTypeNorms[g.key]?.[b] ?? 0).toFixed(4))]);
        }
    }
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `road-orientations_${cityName.replace(/\s+/g, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

// --- PNG Export ---
function exportPNG() {
    const cityName = searchInput.value.trim() || 'unknown';
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `road-orientations_${cityName.replace(/\s+/g, '-').toLowerCase()}.png`;
    a.click();
}

document.getElementById('export-csv-btn').onclick = exportCSV;
document.getElementById('export-png-btn').onclick = exportPNG;

// --- Tip popup (fixed-position, viewport-aware) ---
const tipPopup = document.getElementById('tip-popup');
let activeTip = null;

function showTipPopup(tip) {
    const text = tip.dataset.tip;
    if (!text) return;
    tipPopup.textContent = text;
    tipPopup.style.display = 'block';
    tipPopup.style.visibility = 'hidden';
    tipPopup.style.left = '-9999px';

    // Measure after render
    requestAnimationFrame(() => {
        const rect = tip.getBoundingClientRect();
        const pw = tipPopup.offsetWidth;
        const ph = tipPopup.offsetHeight;
        const gap = 8;
        const margin = 10;

        const preferBelow = tip.classList.contains('below');
        let top, bottom;

        if (preferBelow) {
            top = rect.bottom + gap;
            if (top + ph > window.innerHeight - margin) top = rect.top - ph - gap;
        } else {
            top = rect.top - ph - gap;
            if (top < margin) top = rect.bottom + gap;
        }

        let left = rect.left + rect.width / 2 - pw / 2;
        left = Math.max(margin, Math.min(left, window.innerWidth - pw - margin));

        tipPopup.style.left = left + 'px';
        tipPopup.style.top = top + 'px';
        tipPopup.style.visibility = '';
    });
}

document.addEventListener('mouseover', (e) => {
    const tip = e.target.closest('.tip');
    if (tip === activeTip) return;
    activeTip = tip;
    if (tip && tip.dataset.tip) {
        showTipPopup(tip);
    } else {
        tipPopup.style.display = 'none';
    }
});

document.addEventListener('mouseout', (e) => {
    if (!activeTip) return;
    if (!activeTip.contains(e.relatedTarget)) {
        activeTip = null;
        tipPopup.style.display = 'none';
    }
});
