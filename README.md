# Fire Monitor Indonesia — web

Interactive map and statistics of burned area in Indonesia: drill down from the country to provinces, regencies, districts and villages (or thematic layers like concessions and protected areas), and see burned-area totals, monthly/annual series, land-cover breakdown and territory rankings for any period.

Data comes from the public MapBiomas Fogo Indonesia API (`https://fogo-id.geodatin.com/api`, run by Geodatin). Map and fire layers are Google Earth Engine tiles served through that API.

## Stack

- React 19 + TypeScript, built with Vite
- MapLibre GL (CARTO basemaps + Esri satellite) for the map
- ECharts for charts, TanStack Query for data fetching, cmdk for the ⌘K search
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
npm run dev       # http://localhost:5173
```

| Script            | What it does                         |
| ----------------- | ------------------------------------ |
| `npm run dev`     | Dev server with HMR                  |
| `npm run build`   | Type-check and build to `dist/`      |
| `npm run preview` | Serve the production build locally   |
| `npm run lint`    | Run Oxlint                           |

No environment variables are needed. The API base URL is set in `src/api.ts`.

## Project structure

```
src/
  main.tsx         entry: React Query provider + App
  App.tsx          layout: header, map, stats sidebar
  state.ts         URL-backed app state (territory, period, filters)
  api.ts           API client and React Query hooks
  MapView.tsx      MapLibre map, overlays, territory hover/click
  MapControls.tsx  floating map controls, period slider, area-to-GIF tool
  Stats.tsx        statistics cards
  Palette.tsx      ⌘K territory search
  inside.ts        finds thematic-layer features inside a territory (runs inside.worker.ts in a Web Worker)
  Header.tsx, Breadcrumb.tsx, ui.tsx, i18n.ts, index.css
public/            favicon and logos
```

## Deploy to Vercel

1. Push this folder to GitHub (as the repo root, or as a subfolder of a larger repo).
2. In Vercel, **Add New → Project** and import the repository.
3. If `web/` is a subfolder, set **Root Directory** to `web`.
4. Leave the defaults Vercel detects for Vite:
   - Build command: `npm run build`
   - Output directory: `dist`
   - Install command: `npm install`
5. Deploy. No environment variables are required.

No `vercel.json` is needed: the app is a single page at `/` and keeps its state in the query string, so there are no client-side routes to rewrite.

## Notes

- The API is third-party, unauthenticated and has no SLA. Earth Engine tile and GIF URLs expire after a few hours, so the app refetches them instead of caching them.
- The GIF tool can take 10–20 seconds because Earth Engine renders the animation on request.
