import * as maplibregl from 'maplibre-gl';
import type { ExpressionSpecification, FilterSpecification, StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { groupingTilesUrl, shapeTilesUrl } from '../api';
import type { AppState } from '../state';

maplibregl.setWorkerUrl(workerUrl);

// Earth Engine sometimes answers 429/5xx under load, and MapLibre never retries a failed tile
// (it stays blank until the next zoom). Tile URLs starting with "retry://" are retried with backoff.
const MAX_RETRIES = 3;
maplibregl.addProtocol('retry', async ({ url }, abortController) => {
  const tileUrl = url.slice('retry://'.length);
  for (let attempt = 0; ; attempt++) {
    const isLastAttempt = attempt === MAX_RETRIES;
    const response = await fetch(tileUrl, { signal: abortController.signal }).catch((error) => {
      if (abortController.signal.aborted || isLastAttempt) throw error;
    });
    if (response?.ok) return { data: await response.arrayBuffer() };
    const isRetryable = response && (response.status === 429 || response.status >= 500);
    if (response && (!isRetryable || isLastAttempt)) throw new Error(`${response.status} ${tileUrl}`);
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
});

export const STYLES: Record<string, string | StyleSpecification> = {
  dark: import.meta.env.VITE_BASEMAP_DARK,
  light: import.meta.env.VITE_BASEMAP_LIGHT,
  satellite: {
    version: 8,
    sources: {
      sat: {
        type: 'raster',
        tiles: [import.meta.env.VITE_BASEMAP_SATELLITE],
        tileSize: 256,
        maxzoom: 18,
        attribution: 'Esri, Maxar, Earthstar Geographics',
      },
    },
    layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
  },
};

export type Overlay = {
  fireUrl?: string;
  heatUrl?: string;
  grouping: string;
  focusUrl: string;
  filter: FilterSpecification | null;
  opacity: number;
  /** territory code → fill opacity when "paint map" is on */
  paintValues: Map<number, number>;
  theme: 'dark' | 'light';
  paintColor: string;
  focusColor: string;
  /** whole country selected: the coastline is the boundary, so no outline */
  national: boolean;
  /** darken everything outside the territory (layers whose shapes reach far beyond it) */
  dimOutside: boolean;
  /** also darken everything outside the selected thematic layer's shapes */
  clipGroup: boolean;
};

export const SOURCE_LAYER = 'default';
export const INDONESIA_BOUNDS: [[number, number], [number, number]] = [
  [94.9, -11.1],
  [141.1, 6.1],
];
// leaves room for the floating controls around the map
export const FIT_PADDING = { top: 80, bottom: 90, left: 40, right: 70 };

/** Only show the sub-territories that belong to the selected territory. */
export function selectionFilter(state: AppState): FilterSpecification | null {
  if (state.type === 'country') return null;
  if (state.grouping === state.type) return ['==', ['get', 'code'], state.code];
  return ['==', ['get', `${state.type}Code`], state.code];
}

// Flatten the CARTO basemap's land/water colors to the original platform's tones.
const BASEMAP_TINT = { dark: { land: '#171718', water: '#121213' }, light: { land: '#f7f8f7', water: '#d9ddde' } };
export function tintBasemap(map: maplibregl.Map, theme: 'dark' | 'light') {
  const colors = BASEMAP_TINT[theme];
  for (const layer of map.getStyle().layers) {
    if (layer.type === 'background') map.setPaintProperty(layer.id, 'background-color', colors.land);
    else if (layer.type === 'fill' && layer.id.startsWith('water')) map.setPaintProperty(layer.id, 'fill-color', colors.water);
    else if (layer.type === 'fill' && /^(landcover|landuse|park)/.test(layer.id)) map.setPaintProperty(layer.id, 'fill-color', colors.land);
  }
}

const firstLabelLayer = (map: maplibregl.Map) => map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id;

function setRasterLayer(map: maplibregl.Map, id: string, url: string | undefined, opacity: number | ExpressionSpecification, beforeLayer?: string, maxzoom?: number) {
  const source = map.getSource(id) as maplibregl.RasterTileSource | undefined;
  if (!url) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (source) map.removeSource(id);
    return;
  }
  const retryUrl = `retry://${url}`;
  if (!source) {
    map.addSource(id, { type: 'raster', tiles: [retryUrl], tileSize: 256 });
    map.addLayer(
      { id, type: 'raster', source: id, maxzoom, paint: { 'raster-opacity': opacity, 'raster-fade-duration': 200, 'raster-resampling': 'nearest' } },
      beforeLayer,
    );
    return;
  }
  if (source.tiles?.[0] !== retryUrl) source.setTiles([retryUrl]);
  map.setPaintProperty(id, 'raster-opacity', opacity);
}

// MapLibre only fills VectorTileSource.tiles after loading, so remember the URLs ourselves.
const vectorSourceUrls = new Map<string, string>();
/** Adds or updates a vector source. Returns true when it was just created (its layers still need adding). */
function setVectorSource(map: maplibregl.Map, id: string, url: string) {
  const source = map.getSource(id) as maplibregl.VectorTileSource | undefined;
  if (source && vectorSourceUrls.get(id) === url) return false;
  vectorSourceUrls.set(id, url);
  if (source) {
    // swapping tiles in place keeps the old ones visible until the new ones arrive
    source.setTiles([url]);
    return false;
  }
  map.addSource(id, { type: 'vector', tiles: [url], promoteId: 'code', minzoom: 0, maxzoom: 14 });
  return true;
}

/**
 * Draws everything on top of the basemap:
 * - focus: outline + light tint marking the selected territory
 * - heat/fire: Earth Engine heatmap when zoomed out, burn-scar pixels when zoomed in
 * - grp: sub-territories as dashed lines, or a choropleth when "paint map" is on
 */
export function applyOverlay(map: maplibregl.Map, overlay: Overlay) {
  const beforeLabels = firstLabelLayer(map);
  const fireOpacity = overlay.opacity / 100;
  const isDark = overlay.theme === 'dark';
  const isSatellite = map.getStyle().layers.some((layer) => layer.id === 'sat');
  const landColor = BASEMAP_TINT[overlay.theme].land;

  // The shape tiles cover everything *outside* the territory, so the territory itself is the hole.
  if (setVectorSource(map, 'focus', overlay.focusUrl)) {
    map.addLayer({ id: 'focus', type: 'fill', source: 'focus', 'source-layer': SOURCE_LAYER, paint: { 'fill-outline-color': 'rgba(0,0,0,0)' } }, beforeLabels);
    map.addLayer(
      {
        id: 'focus-line',
        type: 'line',
        source: 'focus',
        'source-layer': SOURCE_LAYER,
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 8, 1.2, 12, 2],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.45, 8, 0.7],
        },
      },
      beforeLabels,
    );
  }
  const focusColor = isSatellite ? '#ffffff' : overlay.focusColor;
  const tintOpacity = isSatellite ? 0.04 : isDark ? 0.06 : 0.05;
  map.setPaintProperty('focus', 'fill-color', overlay.dimOutside ? landColor : focusColor);
  map.setPaintProperty('focus', 'fill-opacity', overlay.dimOutside ? 0.85 : tintOpacity);
  map.setPaintProperty('focus-line', 'line-color', focusColor);
  for (const id of ['focus', 'focus-line']) map.setLayoutProperty(id, 'visibility', overlay.national ? 'none' : 'visible');

  // Country-wide shape tiles of a thematic layer: covers everything outside that layer's shapes.
  if (setVectorSource(map, 'gfocus', shapeTilesUrl('country', 1, overlay.grouping))) {
    map.addLayer({ id: 'gfocus', type: 'fill', source: 'gfocus', 'source-layer': SOURCE_LAYER, paint: { 'fill-outline-color': 'rgba(0,0,0,0)' } }, beforeLabels);
  }
  map.setPaintProperty('gfocus', 'fill-color', landColor);
  map.setPaintProperty('gfocus', 'fill-opacity', 0.85);
  map.setLayoutProperty('gfocus', 'visibility', overlay.clipGroup ? 'visible' : 'none');

  // Heatmap fades out between zoom 7 and 9 while the burn-scar pixels fade in.
  setRasterLayer(map, 'heat', overlay.heatUrl, ['interpolate', ['linear'], ['zoom'], 7, fireOpacity, 9, 0], beforeLabels, 9);
  setRasterLayer(map, 'fire', overlay.fireUrl, ['interpolate', ['linear'], ['zoom'], 7, 0, 9, fireOpacity], beforeLabels);

  if (setVectorSource(map, 'grp', groupingTilesUrl(overlay.grouping))) {
    const isHovered: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false];
    const hoverOpacity = isDark ? 0.2 : 0.15;
    map.addLayer(
      {
        id: 'grp-fill',
        type: 'fill',
        source: 'grp',
        'source-layer': SOURCE_LAYER,
        paint: {
          'fill-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5,
            ['case', isHovered, hoverOpacity, ['coalesce', ['feature-state', 'paint'], 0]],
            7,
            ['case', isHovered, hoverOpacity, 0],
          ],
        },
      },
      beforeLabels,
    );
    map.addLayer({ id: 'grp-line', type: 'line', source: 'grp', 'source-layer': SOURCE_LAYER, paint: { 'line-width': 1, 'line-dasharray': [1, 2] } }, beforeLabels);
  }
  const hoverColor = isDark ? '#ffffff' : '#000000';
  map.setPaintProperty('grp-fill', 'fill-color', ['case', ['boolean', ['feature-state', 'hover'], false], hoverColor, overlay.paintColor]);
  map.setPaintProperty('grp-line', 'line-color', isDark && !isSatellite ? '#666' : '#bbb');
  map.setPaintProperty('grp-line', 'line-opacity', overlay.paintValues.size ? 0 : isDark && !isSatellite ? 0.6 : 1);
  map.setFilter('grp-fill', overlay.filter);
  map.setFilter('grp-line', overlay.filter);

  // Layer order: the plain tint sits under the fire layers; darkening and outlines sit on top.
  map.moveLayer('focus', overlay.dimOutside ? beforeLabels : ['heat', 'fire', 'grp-fill'].find((id) => map.getLayer(id)));
  map.moveLayer('gfocus', beforeLabels);
  map.moveLayer('focus-line', beforeLabels);

  map.removeFeatureState({ source: 'grp', sourceLayer: SOURCE_LAYER });
  overlay.paintValues.forEach((paint, code) => map.setFeatureState({ source: 'grp', sourceLayer: SOURCE_LAYER, id: code }, { paint }));
}
