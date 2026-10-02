# Fire Monitor Indonesia — web

Interactive map and statistics of burned area in Indonesia: drill down from the country to provinces, regencies, districts and villages (or thematic layers like concessions and protected areas), and see burned-area totals, monthly/annual series, land-cover breakdown and territory rankings for any period.

Data comes from the public MapBiomas Fogo Indonesia API (`https://fogo-id.geodatin.com/api`, run by Geodatin). Map and fire layers are Google Earth Engine tiles served through that API.

## Stack

- React 19 + TypeScript, built with Vite
- MapLibre GL (CARTO basemaps + Esri satellite) for the map
- ECharts for charts, TanStack Query for data fetching, cmdk for the ⌘K search
- Zustand for app state (kept in sync with the URL), Tailwind CSS v4 for styling
- Oxlint for linting

## Features

- Territory drill-down by clicking the map, with breadcrumbs, plus ⌘K / Ctrl+K search across every territory type
- Year and month-range filters, land-cover filter, basemap and layer opacity controls
- Statistics sidebar: burned area, time series, land cover by level, ranking (with an option to paint it on the map), CSV download and share link per card
- Draw a rectangle on the map to get a timelapse GIF of burn scars
- English, Bahasa Indonesia and Portuguese; dark and light themes
- All state lives in the URL, so any view can be shared or bookmarked

## Getting started

Requires Node.js 22.12 or newer.

```bash
npm install
cp .env.example .env
npm run dev       # http://localhost:5173
```

| Script            | What it does                         |
| ----------------- | ------------------------------------ |
| `npm run dev`     | Dev server with HMR                  |
| `npm run build`   | Type-check and build to `dist/`      |
| `npm run preview` | Serve the production build locally   |
| `npm run lint`    | Run Oxlint                           |

Configuration lives in `.env` (copy `.env.example`): the API address, the MapBiomas link and the basemap URLs, plus `DOMAIN` for production. The build stops with an error if a `VITE_*` value is missing. `VITE_*` values end up in the public JS, so never put secrets there.

## Project structure

```
src/
  main.tsx, App.tsx   entry and page layout
  state.ts            Zustand stores: view state (synced with the URL) and preferences (theme, language)
  i18n.ts             translations (en / id / pt) and number/month formatting
  hooks.ts            theme, color tokens, click-outside
  ui.tsx              shared components: Modal, Overlay, Toaster, ApiStatus, EChart, Skeleton
  index.css           Tailwind setup, theme colors, the few styles utilities can't express
  Header.tsx, Breadcrumb.tsx, Palette.tsx   top bar, breadcrumb, ⌘K search
  api/
    client.ts         fetch helper, cache settings, tile URLs
    territory.ts      years, territories, search, bounds
    stats.ts          area, time series, land cover, ranking, fire tiles, GIF
    thematic.ts       which thematic layers have data in a territory
    inside.ts + inside.worker.ts   finds a layer's features inside a territory (in a Web Worker)
  map/
    MapView.tsx       the MapLibre map, hover and click
    overlay.ts        map layers: fire, heatmap, outline, sub-territories
    MapControls.tsx   floating controls; uses Dropdown, TimeBar, AreaGif
  stats/
    Stats.tsx         sidebar with the four cards (Area, Series, Ranking, LandCover)
  lib/                small helpers (tile math, CSV download, copy link)
public/               favicon and logos
```

## Notes

- The API is third-party, unauthenticated and has no SLA. Earth Engine tile and GIF URLs expire after a few hours, so the app refetches them instead of caching them.
- The GIF tool can take 10–20 seconds because Earth Engine renders the animation on request.

## Production

`compose.yml` runs the site behind Caddy, which serves `https://$DOMAIN` (a comma-separated list works too, e.g. `DOMAIN="fire.example.com, www.fire.example.com"`) and gets the certificates automatically. Point the domain's DNS at the server, then:

```bash
cp .env.example .env    # set DOMAIN and adjust the URLs
docker compose up -d --build
```

The `Dockerfile` builds the site (config comes in as build args) and serves it from an unprivileged nginx on port 8080. Unknown paths fall back to `index.html` (all state is in the URL), `/assets` is cached for a year, and `/healthz` returns `ok`.

CI (`.github/workflows/ci.yml`) lints and builds every push and pull request using `.env.example`. Each push to `main` then deploys over SSH: on the first run it clones the repo into `DEPLOY_PATH` (default `~/monthly-fire-indonesia`), afterwards it pulls, and it rebuilds with `docker compose up -d --build` using the server's own `.env`.

Setup: on the server install Docker and git, add the SSH user to the `docker` group, open ports 80/443 and point DNS at it. On GitHub add the secrets `SSH_HOST`, `SSH_USER`, `SSH_KEY` (and `SSH_PASSPHRASE` if the key has one), optionally the variable `DEPLOY_PATH`. The first deploy stops after cloning because `.env` is missing: create it there (`cp .env.example .env`, set the `VITE_*` values and `DOMAIN`) and re-run the job.
