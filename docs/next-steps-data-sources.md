# Road Orientations — Next Steps & Data Sources

_Last updated: 2026-03-19_

---

## FUSE Maps Integration (Priority)

**FuseMaps** (https://fusemaps.yourchosen.one) is a friend's commercial location intelligence platform. API access is being arranged.

**What they have:**
- 5M POIs with economic/social activity signals (36+ months historical)
- 64M building locations
- 3M street assets with walkability + accessibility metrics
- H3 hexagonal zone analysis + custom polygons
- AI synthesis (FUSE Copilot)
- Pricing: $99/mo per seat or $1,237/year

**Integration plan:**
- Use FUSE data to power the **POI tab** and **People tab** instead of raw Overpass + Tom Forth
- OSM + GHSL remain as the **open/reproducible base** (Roads tab stays academic-citable)
- FUSE enriches the commercial/demo layer on top
- Road Orientations becomes a **free open-source showcase** for what FUSE data looks like visually — mutual benefit: friend gets a live demo for client pitches, we get richer data

**Data layer mapping (wireframe tabs → data source):**

| Tab | Open source (default) | FUSE (when API available) |
|---|---|---|
| Roads | OSM / Overpass | OSM + FUSE street assets |
| People | GHSL / Tom Forth API | FUSE synthetic population + building data |
| POI | OSM amenity/Overpass | FUSE 5M POI dataset |
| Land use | OSM landuse polygons | FUSE zone analysis |

**Architecture note:** Abstract the data layer now so swapping OSM → FUSE is a config/adapter change, not a rewrite. FUSE API docs are "coming soon" — request early access.

---

## Similar / Reference Projects

| Project | URL | What it does | Relevance |
|---|---|---|---|
| **CityAccessMap** | https://cityaccessmap.com | 15-min city accessibility per grid cell — walking distance to 7 amenity groups (Education, Health, Food, Mobility, etc.) | MIT open source (TU Delft); same OSM+GHSL stack; only NYC data in repo — use their *methodology* not their data files; compute same 7 scores from Overpass amenity query |
| **WorldMonitor** | — | OSINT-style city intelligence dashboard | Design inspiration: clean panel layout, tab-driven data |
| **Tom Forth Ring Populations** | https://www.tomforth.co.uk/circlepopulations/ | Population within radius circles using GHSL grid | Already integrated for population per ring |
| **HCMC OneMap** | https://bando.tphcm.gov.vn | 200-layer city GIS platform (Vietnam) | TOD circle tool, multi-criteria scoring, service accessibility heat maps |

---

## Current Data Sources

| Source | Data | API / Access | Notes |
|---|---|---|---|
| **OpenStreetMap / Overpass** | Road network (geometry, type, name) | `overpass-api.de/api/interpreter` | Live; large radius = slow |
| **GHSL 2025 (EU JRC)** | Population grid (100m resolution) | Via Tom Forth's Azure API | Max 50 km radius; less accurate for small/fast-growing areas |
| **Tom Forth Ring Populations API** | Population + bus/tram/rail stops per km ring | `ringpopulationsapi.azurewebsites.net` | Returns array by integer km; one call = all rings |
| **Nominatim (OSM)** | Geocoding (city search → lat/lon) | `nominatim.openstreetmap.org` | Use `lat`/`lon` from properties, not bbox midpoint |

---

## Feature Ideas & Next Steps

### Near-term (no new data sources needed)
- [ ] **Build actual redesign** — implement the approved wireframe layout (map left, analysis panel right, 4 tabs)
- [ ] **Grid density heatmap** — compute road entropy or km/km² per 100×100m cell and render as map layer (data: already in OSM fetch)
- [ ] **Permalink / share** — URL hash `#lat,lng,zoom,radii,mode` for sharing specific views
- [ ] **PNG export** — 600×300px canvas at 2× DPR → 1200×600px PNG (client-side)
- [ ] **City presets** — Manhattan, Paris, Barcelona, Tokyo, HCMC as quick-load buttons

### Medium-term (additional data layers)
- [ ] **Built-up area per ring** — GHSL built-up surface (GHS-BUILT) layer; same API family as population
- [ ] **Service accessibility score** — distance to nearest transit stop, park, school per ring; benchmark vs. city average (inspired by CityAccessMap + HCMC OneMap)
- [ ] **POI density tab** — Overpass query for amenity/shop/tourism nodes; show POI count and type breakdown per ring
- [ ] **Land use tab** — OSM landuse polygons per ring (residential, commercial, industrial, green); stacked bar breakdown

### Longer-term (backend / heavier compute)
- [ ] **Multi-criteria composite score** — weighted slider for: transit access + road density + population density + green space → walkability/liveability score (HCMC OneMap pattern)
- [ ] **City comparison mode** — 3-column layout, independent panel per city, same metrics side-by-side
- [ ] **Flood / subsidence overlay** — climate risk layer (relevant for coastal/delta cities like HCMC, Jakarta, Bangkok)
- [ ] **AI synthesis** — Claude API processes ring stats + OSM metadata → natural-language report ("This area has a highly irregular street grid typical of organic medieval growth…")
- [ ] **Supabase backend** — cache Overpass results by bounding box + timestamp; serve pre-computed entropy/density for popular cities

---

## Data Sources to Investigate

| Source | Data | URL | Notes |
|---|---|---|---|
| **GHS-BUILT (GHSL)** | Built-up surface area grid | https://ghsl.jrc.ec.europa.eu/ghs_buS2023.php | Same API family; could use Tom Forth or direct |
| **OpenStreetMap landuse** | Land use polygons | Overpass (`landuse=*` within circle) | Already fetching OSM; add landuse query |
| **Overpass amenity/POI** | Points of interest | Overpass (`amenity=*`, `shop=*`, `tourism=*`) | One extra query alongside road query |
| **Global Human Settlement Layer** | Population, built-up, urban centres | https://ghsl.jrc.ec.europa.eu | Open; 2025 epoch available |
| **OpenRouteService** | Isochrones (walk/bike/transit) | https://openrouteservice.org | Free tier; complements ring analysis with travel-time shapes |
| **Protomaps / PMTiles** | Self-hosted vector tiles | https://protomaps.com | Remove CDN dependency; faster tile loading |
| **MapTiler** | Basemap tiles (satellite + streets) | https://maptiler.com | Alternative to current CARTO/Esri setup |
| **GTFS feeds** | Actual transit schedules & routes | transit.land / city open data | Higher fidelity than OSM stops count |

---

## Architecture Notes

- **Client-side first** — no backend until user volume justifies it
- **Supabase** — planned for caching Overpass results + user-saved locations (user is comfortable with Supabase + GitHub Actions)
- **Open source** — publish like WorldMonitor / OSINT tools; academic-lean audience
- **PhD research angle** — tool as research instrument; entropy + density + accessibility as urban form metrics

---

## References

- HCMC OneMap PDF: `docs/hcmc-onemap-vector-grid-v3.pdf` (or https://hcmusta.org.vn/wp-content/uploads/2024/07/Vector-Grid-For-OneMap-Vie-v3.pdf)
- Tom Forth blog: https://www.tomforth.co.uk/circlepopulations/
- GHSL: https://ghsl.jrc.ec.europa.eu/
- Overpass API: https://overpass-api.de/
- CityAccessMap: https://cityaccessmap.com
