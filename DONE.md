# DONE — v1 rewrite status

## What shipped (relative to v0-static, tagged `v0-static`)

- Stack: Vite + React 19 + TS + Tailwind v4 + shadcn/ui (Base UI primitives, `cn` from `cn` package).
- **Map engine: MapLibre GL JS 6 + CARTO vector basemaps** (positron / dark-matter, no API key).
  A brief NAVER Maps detour was rolled back per supervisor; no keys/env needed anymore.
- Isochrones redesigned away from the v0 raster: time-grid (250 m) → marching squares → **smoothed closed
  rings**, delivered as translucent GeoJSON Polygon fills + outline line. "Reachable within T" is now a
  set-membership definition — unreachable areas can never be covered (v0's floating-island bug structurally gone).
- Layers: station dots = circle layer (time-colour ramp, grey = unreachable), line paths = line layers
  (official line colours), route = thick line. Legend = isochrone colour ramp + line legend.
- UI: tabbed shell (isochrones / station rankings / about), sidebar on desktop, **mobile full-bleed map** with
  floating search card, `?from=&to=` URL state, dark/light/system with `html.dark`.
- **No unit tests** (deleted per supervisor — "unit tests are too cumbersome; E2E only"). Visual gate:
  `scripts/verify-screenshots.mjs` + `.agents/skills/verify-seoul-tram/SKILL.md`.

## Verification results

- Core compute smoke: Dijkstra 2.7 ms + grid 3.7 ms + contour rings ~36 ms for the full network; sanity
  checks — 시청→강남 36.3 min, 시청→인천공항2T 77.6 min (both inside the 30–90 common-sense band).
- E2E: 5/5 screenshots **ALL PASS** on `localhost:4173` (light/dark/desktop + dark + mobile): canvas present,
  basemap attribution `© CARTO, © OpenStreetMap contributors` loaded, dark shots carry `.dark` + dark-matter,
  zero console/network errors (favicon noise filtered). Script keeps `--use-angle=swiftshader-webgl` flags —
  without them headless Chrome hangs or renders an empty map (see `--virtual-time-budget` note in DONE history).

## Known gaps / next steps

- Real-time arrivals API (v1 feature removed by design — v0 already dropped it; kept here for the record).
- Station dots may vanish under dense ring fill at country zoom — acceptable (zoom in reveals them; legend
  ramp carries the meaning).
- If a future change touches MapLibre/vite config, re-run the verify script **before committing**; its
  failure-mode table in the skill file lists the three silent breakages (worker URL, v6 paint keys, theme pairing).
