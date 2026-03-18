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
let globalNormalizedBins = []; // radii mode: indexed by ring
let globalTypeNorms = {};      // type mode: keyed by type group

let radii = [1.0, 3.0, 5.0];
let hoveredRingIndex = -1;
let colorMode = 'radii'; // 'radii' | 'type'

const h = 300; 
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
// attribution handled by custom #map-attribution element

const centerMarker = new maplibregl.Marker({ color: '#1e293b', draggable: true })
    .setLngLat(pinnedCenter)
    .addTo(map);

// --- Custom Search ---
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
    if (!document.getElementById('search-container').contains(e.target)) searchResultsEl.style.display = 'none';
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
            const name = item.display_name.split(',').slice(0, 3).join(',');
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
    searchInput.value = item.display_name.split(',')[0];
    searchResultsEl.style.display = 'none';
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
    document.getElementById('center-info').textContent = `${pinnedCenter[1].toFixed(4)}°N, ${pinnedCenter[0].toFixed(4)}°E`;
}

// --- UI Setup ---
document.getElementById('sidebar-toggle').onclick = () => {
    document.body.classList.toggle('sidebar-open');
    document.getElementById('sidebar-toggle').textContent = document.body.classList.contains('sidebar-open') ? '✕' : '☰';
    setTimeout(() => map.resize(), 350);
};


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
                if (vis !== 'none') {
                    map.setLayoutProperty(id, 'visibility', 'none');
                    satelliteHiddenLayers.push(id);
                }
            } else if (type === 'line') {
                map.setPaintProperty(id, 'line-opacity', vectorOpacity);
            } else if (type === 'symbol') {
                map.setPaintProperty(id, 'text-opacity', vectorOpacity);
                map.setPaintProperty(id, 'icon-opacity', vectorOpacity);
            }
        }
    } else {
        for (const id of satelliteHiddenLayers) {
            map.setLayoutProperty(id, 'visibility', 'visible');
        }
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
    document.getElementById('basemap-card-streets').classList.toggle('active', !isSatelliteMode);
    document.getElementById('basemap-card-satellite').classList.toggle('active', isSatelliteMode);
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

const attrToggle = document.getElementById('attr-toggle');
const attrText = document.getElementById('attr-text');
attrToggle.onclick = () => { attrText.style.display = attrText.style.display === 'block' ? 'none' : 'block'; };
document.addEventListener('click', (e) => {
    if (!document.getElementById('map-attribution').contains(e.target)) attrText.style.display = 'none';
});

document.getElementById('color-mode-radii').onclick = () => {
    colorMode = 'radii';
    document.getElementById('color-mode-radii').classList.add('active');
    document.getElementById('color-mode-type').classList.remove('active');
    document.getElementById('road-type-list').style.display = 'none';
    hoveredRingIndex = -1; renderRadiiUI(); processAndDrawChart(); updateMapRings();
};
document.getElementById('color-mode-type').onclick = () => {
    colorMode = 'type';
    document.getElementById('color-mode-type').classList.add('active');
    document.getElementById('color-mode-radii').classList.remove('active');
    document.getElementById('road-type-list').style.display = 'flex';
    hoveredRingIndex = -1; renderRadiiUI(); processAndDrawChart(); updateMapRings();
};

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
            if (val > 0) { radii[i] = val; radii.sort((a, b) => a - b); renderRadiiUI(); triggerHybridAnalysis(); updateMapRings(); }
        };
        row.querySelector('.remove-btn').onclick = () => {
            if (radii.length > 1) { radii.splice(i, 1); hoveredRingIndex = -1; renderRadiiUI(); triggerHybridAnalysis(); updateMapRings(); }
        };
        container.appendChild(row);
    });
}

document.getElementById('add-radius-btn').onclick = () => { radii.push(radii[radii.length - 1] + 2.0); renderRadiiUI(); triggerHybridAnalysis(); updateMapRings(); };

function renderRoadTypeUI() {
    const container = document.getElementById('road-type-list');
    container.innerHTML = '';
    roadTypeGroups.forEach(g => {
        const row = document.createElement('label');
        row.className = 'type-row';
        row.innerHTML = `<input type="checkbox" ${activeTypeGroups.has(g.key) ? 'checked' : ''} data-key="${g.key}">
            <span class="color-swatch" style="background:${g.color}"></span>
            <span class="type-label">${g.label}</span>`;
        row.querySelector('input').onchange = (e) => {
            if (e.target.checked) activeTypeGroups.add(g.key); else activeTypeGroups.delete(g.key);
            processAndDrawChart();
        };
        container.appendChild(row);
    });
}

function updateStatus(state) {
    const el = document.getElementById('data-status');
    el.className = state;
    if (state === 'fast') el.innerText = "FAST (MAP VIEW)";
    if (state === 'fetching') el.innerText = "FETCHING PRECISE DATA...";
    if (state === 'precise') el.innerText = "PRECISE (OVERPASS)";
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
        else console.error("Overpass fetch failed:", error);
        return null;
    }
}

async function triggerHybridAnalysis() {
    currentSegments = extractLocalSegments();
    updateStatus('fast');
    processAndDrawChart();

    const fetchRadius = radii[radii.length - 1] + 1; 
    const preciseSegments = await fetchOverpassSegments(pinnedCenter, fetchRadius);
    
    if (preciseSegments) {
        currentSegments = preciseSegments;
        updateStatus('precise');
        processAndDrawChart();
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

function processAndDrawChart() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const bearing = map.getBearing();
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(-bearing * Math.PI / 180);

    ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.5; ctx.beginPath();
    ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke();

    if (!currentSegments || currentSegments.length === 0) { ctx.restore(); return; }

    const ruler = new CheapRuler(pinnedCenter[1]);

    if (colorMode === 'radii') {
        // --- Radii mode: cumulative rings, colored by distance band ---
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

        if (maxPercentage === 0) { ctx.restore(); return; }

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
        // --- Type mode: cumulative per type, same rings logic as radii mode ---
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
            for (let rIdx = 0; rIdx < radii.length; rIdx++) {
                if (distToCenter <= radii[rIdx]) { ringIndex = rIdx; break; }
            }
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

        // Shared total (all types, all raw rings)
        let total = 0;
        roadTypeGroups.forEach(g => {
            if (!stackedTypeBins[g.key]) return;
            for (let ring = 0; ring < radii.length; ring++)
                for (let b = 0; b < numBins; b++) total += stackedTypeBins[g.key][ring][b];
        });
        if (total === 0) { ctx.restore(); return; }

        // Build cumulative normalized bins per type per ring
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
        if (maxPercentage === 0) { ctx.restore(); return; }

        // Store flat tooltip data: use hovered ring or outermost
        const tooltipRing = hoveredRingIndex !== -1 ? hoveredRingIndex : radii.length - 1;
        globalTypeNorms = {};
        roadTypeGroups.forEach(g => { if (normTypeBins[g.key]) globalTypeNorms[g.key] = normTypeBins[g.key][tooltipRing]; });

        ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 0.5;
        for (let g = 1; g <= 4; g++) {
            ctx.beginPath(); ctx.arc(0, 0, r * Math.sqrt(g / 4), 0, 2 * Math.PI, false); ctx.stroke();
        }

        // Draw back-to-front by type; within each type, outer rings first, inner on top
        ['path', 'service', 'local', 'arterial', 'major'].forEach(key => {
            const g = roadTypeGroups.find(g => g.key === key);
            if (!g || !activeTypeGroups.has(key) || !normTypeBins[key]) return;

            function drawRing(ring, alpha) {
                const norm = normTypeBins[key][ring];
                ctx.fillStyle = g.color; ctx.globalAlpha = alpha;
                ctx.beginPath(); ctx.moveTo(0, 0);
                for (let b = 0; b < numBins; b++) {
                    const a0 = ((b - 0.5) * 360 / numBins - 90) * Math.PI / 180;
                    const a1 = ((b + 0.5) * 360 / numBins - 90) * Math.PI / 180;
                    const pct = norm[b];
                    if (pct > 0) { ctx.arc(0, 0, r * Math.sqrt(pct / maxPercentage), a0, a1, false); ctx.lineTo(0, 0); }
                }
                ctx.fill();
                ctx.globalAlpha = Math.min(alpha + 0.15, 1.0); ctx.strokeStyle = g.color; ctx.lineWidth = 0.7; ctx.stroke();
            }

            if (hoveredRingIndex === -1) {
                for (let ring = radii.length - 1; ring >= 0; ring--) {
                    const t = radii.length === 1 ? 1 : (radii.length - 1 - ring) / (radii.length - 1);
                    drawRing(ring, 0.35 + t * 0.3);
                }
            } else {
                for (let ring = radii.length - 1; ring >= 0; ring--)
                    if (ring !== hoveredRingIndex) drawRing(ring, 0.08);
                drawRing(hoveredRingIndex, 0.75);
            }
        });
    }

    ctx.globalAlpha = 1.0; ctx.restore();
}

// --- Map Ring Geometries ---
function updateMapRings() {
    if (!map.isStyleLoaded()) return;
    const features = [];
    for (let i = radii.length - 1; i >= 0; i--) {
        const radius = radii[i];
        const outerCircle = turf.circle(pinnedCenter, radius, { steps: 64, units: 'kilometers' });
        const coords = [outerCircle.geometry.coordinates[0]];
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

function hideTooltip() {
    document.getElementById('chart-tooltip').style.display = 'none';
}

// --- Event Listeners ---
map.on('load', async () => {
    // Add satellite basemap layer below all Positron layers
    const firstStyleLayerId = map.getStyle().layers[0]?.id;
    map.addSource('satellite', {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© Esri, Maxar, Earthstar Geographics'
    });
    map.addLayer({ id: 'satellite-layer', type: 'raster', source: 'satellite', layout: { visibility: 'none' } }, firstStyleLayerId);

    // Draw rings and start analysis immediately at default center
    updateCenterInfo(); renderRadiiUI(); renderRoadTypeUI(); updateMapRings();
    setTimeout(() => { triggerHybridAnalysis(); }, 400);

    // Geocode HCMC in background and update center when ready
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent('Ho Chi Minh City, Vietnam')}&format=json&limit=1`);
        const data = await res.json();
        if (data.length > 0) {
            pinnedCenter = [parseFloat(data[0].lon), parseFloat(data[0].lat)];
            centerMarker.setLngLat(pinnedCenter);
            map.setCenter(pinnedCenter);
            searchInput.value = 'Ho Chi Minh City';
            updateCenterInfo(); updateMapRings();
        }
    } catch(e) { console.error('Initial geocode failed', e); }
    
    map.on('mousemove', 'analysis-rings-fill', (e) => {
        if (e.features.length > 0) {
            const idx = e.features[0].properties.ringIndex;
            if (idx !== hoveredRingIndex) { hoveredRingIndex = idx; map.getCanvas().style.cursor = 'pointer'; renderRadiiUI(); processAndDrawChart(); updateMapRings(); }
        }
    });
    map.on('mouseleave', 'analysis-rings-fill', () => {
        if (hoveredRingIndex !== -1) { hoveredRingIndex = -1; map.getCanvas().style.cursor = ''; renderRadiiUI(); processAndDrawChart(); updateMapRings(); }
    });
});

map.on('moveend', () => {
    if (document.getElementById('data-status').className === 'fast') {
        currentSegments = extractLocalSegments();
        processAndDrawChart();
    }
});

// Hover logic for chart + Tooltips
const canvasContainer = document.getElementById('canvas-container');
const tooltip = document.getElementById('chart-tooltip');

canvasContainer.addEventListener('mousemove', (e) => {
    const rect = canvasContainer.getBoundingClientRect();
    const mx = e.clientX - rect.left - r;
    const my = e.clientY - rect.top - r;
    const dist = Math.sqrt(mx*mx + my*my);

    if (dist > r) {
        if (colorMode === 'radii' && hoveredRingIndex !== -1) {
            hoveredRingIndex = -1; renderRadiiUI(); processAndDrawChart(); updateMapRings();
        }
        hideTooltip(); return;
    }

    let angleDeg = (Math.atan2(my, mx) * 180 / Math.PI) + 90 + map.getBearing();
    angleDeg = (angleDeg % 360 + 360) % 360;
    const binIndex = Math.round(angleDeg * numBins / 360) % numBins;
    const compassDir = getCompassDirection(angleDeg);

    if (colorMode === 'radii') {
        const bestRing = Math.min(Math.floor((dist / r) * radii.length), radii.length - 1);
        if (bestRing !== hoveredRingIndex) {
            hoveredRingIndex = bestRing; renderRadiiUI(); processAndDrawChart(); updateMapRings();
        }
        if (globalNormalizedBins.length > 0 && hoveredRingIndex !== -1) {
            const pct = globalNormalizedBins[hoveredRingIndex][binIndex];
            const color = getRingColor(hoveredRingIndex);
            tooltip.style.display = 'block';
            tooltip.style.left = e.clientX + 'px';
            tooltip.style.top = e.clientY + 'px';
            tooltip.innerHTML = `
                <div style="display:flex;align-items:center;">
                    <span class="tooltip-dot" style="background:${color}"></span>
                    <span style="color:#94a3b8;">${radii[hoveredRingIndex]}km Ring</span>
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
        const rangeLabel = hoveredRingIndex !== -1 ? ` · within ${radii[hoveredRingIndex]}km` : '';
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
    if (colorMode === 'radii' && hoveredRingIndex !== -1) {
        hoveredRingIndex = -1; renderRadiiUI(); processAndDrawChart(); updateMapRings();
    }
    hideTooltip();
});