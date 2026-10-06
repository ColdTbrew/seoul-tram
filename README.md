# Seoul Tram — Seoul metro isochrone map

Pick an origin station and see **how far / how long**: translucent isochrone rings on a MapLibre map show the
area reachable by metro within ≤15/30/45/60 minutes (walk + wait + ride), with station-to-station route timing
and a platform-level route card. Static site — the whole network graph is precomputed and shipped as two JSON
files, no server, no API keys.

```bash
npm install
npx vite dev                 # dev server (Vite prints the URL; app lives under /seoul-tram/)
npm run build && npx vite preview   # production build → http://localhost:4173/seoul-tram/
node scripts/verify-screenshots.mjs # E2E visual check (see "Verification")
```

## Architecture (three layers)

- **`src/lib/` — pure core.** DOM/React/map-library free, one-way data flow, testable in principle:
  - `graph.ts` — (stop, line)-state Dijkstra over the walking graph; binary heap + Float64 distances;
    bucket spatial index for `nearestStops`; `timeToPoint`/`routeTo` for point-to-point queries.
  - `iso.ts` — 250 m time-grid (scatter seeding around platforms) → **marching-squares closed rings**
    (Infinity handled as finite 999 in edge interpolation; tiny islands dropped; Chaikin ×2 smoothing).
    Rings are output as closed `[lng,lat]` loops, fed directly as GeoJSON Polygon coordinates to MapLibre.
  - `search.ts`, `format.ts`, `constants.ts`, `types.ts` — query parsing, colour ramp, tuning knobs, schema types.
- **`src/map/` — one imperative MapLibre boundary.** `MapCanvas.tsx` is a thin wrapper owning the map instance
  (style reload, layer paint, markers, click/hover hit-testing all live here + `layers.ts`). Nothing else in
  the tree touches MapLibre; no `createStore`, no event bus.
- **`src/hooks/` + `src/components/` — thin glue.** `useTripPlan` runs the derived chain
  (solution → grid → contour features → stops colour → summary); `useNetworkData`/`useTheme` fetch/persist;
  `StationSearch` is a Command+Popover combobox; `App.tsx` is a tabbed shell (isochrones / station rankings /
  about) with `?from=&to=` URL state and a mobile full-bleed layout.

Data flows one way: origin/bounds/theme → derived values in `useTripPlan` → render + repaint.

## Cost model (the interesting half)

- walking: straight-line at **75 m/min**, entering a station costs time proportional to distance, no gates/exits modelled
- boarding & transfer waiting: **average headway / 2** per platform (clamped 1–15 min) — transfers are waits for the
  next train, not fixed penalties
- graph nodes are **platforms** (734 stops / 634 stations / 22 lines from GTFS); same-station platform hops are
  walk+wait edges — the v1 version of this model (v0 had a single fixed transfer penalty, removed as too crude)
- isochrone = "reachable within T" region boundary, not nearest-station distance; unreachable cells are never covered

**Assumptions & limits:** platform-level nodes without real transfer penalties; one average timetable
(morning-peak-ish, no time-of-day); straight-line walking ignores rivers/hills/fences; static site, not live transit.

## Data

`scripts/build_data.py` builds `public/data/network.json` (stops/edges/lines/stations + meta) and
`rankings.json` from GTFS data (data/raw, gitignored). `?from=`/`?to=` accept station names or `lng, lat`.

## Map & basemaps — MapLibre GL JS 6 + CARTO (keyless)

- Light: `positron-gl-style`, dark: `dark-matter-gl-style` (https://basemaps.cartocdn.com/gl/…), swapped via
  `map.setStyle` on theme change; attribution shows `© OpenStreetMap contributors © CARTO`.
- **MapLibre v6 + Vite gotcha (breaks silently):** tile workers must be addressed — `optimizeDeps.exclude:
  ["maplibre-gl"]` in `vite.config.ts` and `setWorkerUrl(workerUrl)` before creating the Map
  (`import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"`). Without it the worker 404s
  and the map renders empty. Only named imports exist in v6 (no default export).

## Verification

`scripts/verify-screenshots.mjs` (headless Chrome via puppeteer-core, SwiftShader WebGL) screenshots
light/dark/route/mobile at `http://localhost:4173/seoul-tram/` (or `VERIFY_BASE=http://100.112.179.83:8195/seoul-tram/`),
collecting console errors + failed requests; PASS requires canvas + basemap attribution + theme match on all shots.
`.agents/skills/verify-seoul-tram/SKILL.md` keeps the runbook and the failure-mode table.

## Deploy

`.github/workflows/deploy.yml`: `npm ci && npx vite build` → Pages artifact (site lives under `/seoul-tram/`,
hence `base: "/seoul-tram/"`). No env secrets — basemaps need no API key.
