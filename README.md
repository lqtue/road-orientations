# Road Orientations

An interactive web tool that visualizes the directional distribution of roads in any city worldwide using a rose diagram.

![Road Orientations](https://img.shields.io/badge/built%20with-MapLibre%20GL-blue) ![License](https://img.shields.io/badge/data-OpenStreetMap-green)

## What it does

Type any city name, and the tool draws a polar rose chart showing how road length is distributed across compass bearings (N, NE, E, SE, S, SW, W, NW…). Cities with a strong grid alignment show dominant spikes; organically grown cities produce rounder, more uniform distributions.

## Features

- **Rose diagram** — 64-bin polar chart of road length by compass bearing
- **Distance rings** — compare road orientation patterns at 1 km, 3 km, 5 km (customizable) from a center pin
- **Dual data modes**
  - *Fast*: instant results from the rendered map
  - *Precise*: full OpenStreetMap data via Overpass API, loaded in the background
- **Road type breakdown** — filter by Major, Arterial, Local, Service, or Path
- **Basemap switcher** — Streets or Satellite with opacity control
- **Hover sync** — hovering a ring on the map highlights the corresponding chart slice and vice versa
- **Permalink** — shareable URL that encodes location, radii, and view state

## How to use

1. Type a city name in the search bar and select from suggestions, or drag the pin directly on the map
2. The rose diagram updates automatically
3. Click **Add Ring** to compare multiple distance bands
4. Switch to **Detail** mode to break down results by road type
5. Hover over the chart or map rings for precise statistics

## Tech stack

| Layer | Library |
|---|---|
| Map rendering | [MapLibre GL](https://maplibre.org/) |
| Basemap tiles | CARTO Positron / Esri satellite |
| OSM data | [Overpass API](https://overpass-api.de/) |
| Geocoding | [Nominatim](https://nominatim.org/) |
| Distance/bearing | [Cheap Ruler](https://github.com/mapbox/cheap-ruler) |
| Geographic shapes | [Turf.js](https://turfjs.org/) |
| Visualization | Canvas 2D API |

No build step — everything runs in the browser via CDN.

## Data sources

Road geometry comes from [OpenStreetMap](https://www.openstreetmap.org/) contributors, served via the Overpass API.
Basemap tiles by [CARTO](https://carto.com/attributions) and [Esri](https://www.esri.com/).

## Run locally

Clone the repo and open `index.html` in a browser — no server required.

```bash
git clone https://github.com/your-username/road-orientations.git
cd road-orientations
open index.html
```

## License

MIT
