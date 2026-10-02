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

Configuration lives in `.env` (copy `.env.example`): the API address, the MapBiomas link and the basemap URLs, plus `DOMAIN` for production. `npm run dev` stops with an error if a `VITE_*` value is missing. The production build is config-free: nginx serves `/config.js` from the container's environment (the server `.env`), and `src/config.ts` reads it. `VITE_*` values reach the browser, so never put secrets there.

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

`compose.yml` runs the site behind Caddy, which serves `https://$DOMAIN` (a comma-separated list works too, e.g. `DOMAIN="fire.example.com, www.fire.example.com"`) and gets the certificates automatically. The `Dockerfile` builds the site without any config and serves it from an unprivileged nginx on port 8080. Unknown paths fall back to `index.html` (all state is in the URL), `/assets` is cached for a year, and `/healthz` returns `ok`.

Run it locally the same way: `cp .env.example .env`, then `docker compose up -d --build`.

### CI/CD

| Workflow | When | What |
|---|---|---|
| `ci.yml` | PRs, pushes to other branches, called by `release.yml` | `changes` (skip if only docs changed) → `test-web` (lint + build); `secrets` (gitleaks scan for leaked credentials) |
| `release.yml` | push to `main` | `changes` (diff since tag `deployed/prod`) → `ci` → `build-web` (image to `ghcr.io/ultramenid/monthly-fire-indonesia:sha-<commit>` + `latest`) → `deploy-prod` → `tag-deployed-prod` |
| `deploy.yml` | called by `release.yml`, or run by hand to roll back | SSH (host key pinned if `SSH_KNOWN_HOSTS` is set), then `deploy/remote-deploy.sh <tag>` on the server |

On the server, `deploy/remote-deploy.sh` (from the checkout just reset to `origin/main`) writes `WEB_TAG` into `.env`, pulls and starts the image, waits until it is healthy and serves the app, and otherwise rolls back to the previous tag. After a good deploy it removes unused images and build cache older than 1 day.

**Rollback:** Actions → Deploy → Run workflow → tag `sha-<older commit>`.

**Setup once**

1. Server: install Docker (with compose) and git, add the SSH user to the `docker` group, open ports 80/443, point each domain's DNS at it.
2. GitHub → Settings → Secrets and variables → Actions → Secrets: `SSH_HOST`, `SSH_USER`, `SSH_KEY` (private key), and `SSH_PASSPHRASE` only if the key has one. Optional:
   - `SSH_KNOWN_HOSTS` pins the server's host key (output of `ssh-keyscan <SSH_HOST>` from a trusted machine, same name/IP as `SSH_HOST`). Without it the deploy trusts the key the server shows when it connects.
   - Variable `DEPLOY_PATH` changes the server folder (default `~/monthly-fire-indonesia`).
3. Push to `main`. The first deploy clones the repo on the server and stops because `.env` is missing: Not needed by hand anymore: the deploy creates the folder (with `sudo -n`, so the SSH user needs passwordless sudo the first time) and `.env` from `.env.example`; set `DOMAIN` there, or add a `DOMAIN` secret before the first deploy, then re-run. Later changes to `.env` apply on the next deploy or `docker compose up -d`; no rebuild needed.
