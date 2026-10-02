import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { type ExpressionSpecification, type FilterSpecification, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { groupingTilesUrl, shapeTilesUrl, useBounds, useFireTiles, useGroupingOptions, useInsideCodes, useRankingFor } from './api';
import { ADMIN_TYPES, selectTerritory, type AppState } from './state';
import { useTheme, useTokens } from './ui';
import { MapControls } from './MapControls';

maplibregl.setWorkerUrl(workerUrl);

// ponytail: free CARTO/Esri basemaps instead of the original's Geodatin Mapbox styles; swap URLs if you get a Mapbox token.
const STYLES: Record<string, string | StyleSpecification> = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  satellite: {
    version: 8,
    sources: {
      sat: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 18,
        attribution: 'Esri, Maxar, Earthstar Geographics',
      },
    },
    layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
  },
};

type Overlay = {
  fireUrl?: string;
  heatUrl?: string;
  grouping: string;
  focusUrl: string;
  filter: FilterSpecification | null;
  opacity: number;
  values: Map<number, number>;
  theme: 'dark' | 'light';
  paintColor: string;
  focusColor: string;
  /** country selected: the coastline is the boundary, so skip the focus tint/border */
  national: boolean;
  /** derived layer: its shapes may run far outside the territory, so black out everything beyond it */
  dimOutside: boolean;
  /** a thematic layer other than the territory itself is selected: also dim everything outside that layer's shapes */
  clipGroup: boolean;
};

const SRC_LAYER = 'default';
const INDONESIA: [[number, number], [number, number]] = [
  [94.9, -11.1],
  [141.1, 6.1],
];
// room for the floating controls (top pills, right zoom column, bottom timeline)
const FIT_PADDING = { top: 80, bottom: 90, left: 40, right: 70 };

/** Feature filter that keeps only the grouping features inside the selected territory. */
function selectionFilter(s: AppState): FilterSpecification | null {
  if (s.type === 'country') return null;
  if (s.grouping === s.type) return ['==', ['get', 'code'], s.code];
  return ['==', ['get', `${s.type}Code`], s.code];
}

// Flatten CARTO land/water to the original platform's basemap tones.
const TINT = { dark: { land: '#171718', water: '#121213' }, light: { land: '#f7f8f7', water: '#d9ddde' } };
function tintBasemap(map: maplibregl.Map, theme: 'dark' | 'light') {
  const c = TINT[theme];
  for (const l of map.getStyle().layers) {
    if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', c.land);
    else if (l.type === 'fill' && l.id.startsWith('water')) map.setPaintProperty(l.id, 'fill-color', c.water);
    else if (l.type === 'fill' && /^(landcover|landuse|park)/.test(l.id)) map.setPaintProperty(l.id, 'fill-color', c.land);
  }
}

function firstSymbolLayer(map: maplibregl.Map) {
  return map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
}

function setRaster(map: maplibregl.Map, id: string, url: string | undefined, opacity: number | ExpressionSpecification, before?: string, maxzoom?: number) {
  const src = map.getSource(id) as maplibregl.RasterTileSource | undefined;
  if (!url) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (src) map.removeSource(id);
    return;
  }
  if (!src) {
    map.addSource(id, { type: 'raster', tiles: [url], tileSize: 256 });
    map.addLayer({ id, type: 'raster', source: id, maxzoom, paint: { 'raster-opacity': opacity, 'raster-fade-duration': 200, 'raster-resampling': 'nearest' } }, before);
  } else {
    if (src.tiles?.[0] !== url) src.setTiles([url]);
    map.setPaintProperty(id, 'raster-opacity', opacity);
  }
}

// source id → tile url currently added (VectorTileSource.tiles is only populated after async load)
const vectorUrls = new Map<string, string>();
function setVector(map: maplibregl.Map, id: string, url: string) {
  const src = map.getSource(id) as maplibregl.VectorTileSource | undefined;
  if (src && vectorUrls.get(id) === url) return false;
  vectorUrls.set(id, url);
  // swap tiles in place: the old ones keep drawing until the new ones arrive, instead of the layer blinking out
  if (src) return src.setTiles([url]), false;
  map.addSource(id, { type: 'vector', tiles: [url], promoteId: 'code', minzoom: 0, maxzoom: 14 });
  return true;
}

// Layer recipe based on the original platform: dim the selected territory, heatmap/burn-scar crossfade, grouping as dashed lines or a ranking choropleth.
function applyOverlay(map: maplibregl.Map, o: Overlay) {
  const before = firstSymbolLayer(map);
  const op = o.opacity / 100;
  const dark = o.theme === 'dark';

  // focus source = shape tiles, which cover everything *outside* the selected territory (the territory is the hole): light tint + a border along the hole that thickens as you zoom in (coastlines get busy zoomed out)
  if (setVector(map, 'focus', o.focusUrl)) {
    map.addLayer({ id: 'focus', type: 'fill', source: 'focus', 'source-layer': SRC_LAYER, paint: { 'fill-outline-color': 'rgba(0,0,0,0)' } }, before);
    map.addLayer(
      {
        id: 'focus-line',
        type: 'line',
        source: 'focus',
        'source-layer': SRC_LAYER,
        paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 8, 1.2, 12, 2], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.45, 8, 0.7] },
      },
      before,
    );
  }
  const sat = map.getStyle().layers.some((l) => l.id === 'sat');
  const focusColor = sat ? '#ffffff' : o.focusColor;
  map.setPaintProperty('focus', 'fill-color', o.dimOutside ? TINT[o.theme].land : focusColor);
  map.setPaintProperty('focus', 'fill-opacity', o.dimOutside ? 0.85 : sat ? 0.04 : dark ? 0.06 : 0.05);
  map.setPaintProperty('focus-line', 'line-color', focusColor);
  for (const id of ['focus', 'focus-line']) map.setLayoutProperty(id, 'visibility', o.national ? 'none' : 'visible');
  // country shape tiles of a layer = mask outside all of its shapes; on top of the territory mask only the layer's shapes inside stay clear
  if (setVector(map, 'gfocus', shapeTilesUrl('country', 1, o.grouping)))
    map.addLayer({ id: 'gfocus', type: 'fill', source: 'gfocus', 'source-layer': SRC_LAYER, paint: { 'fill-outline-color': 'rgba(0,0,0,0)' } }, before);
  map.setPaintProperty('gfocus', 'fill-color', TINT[o.theme].land);
  map.setPaintProperty('gfocus', 'fill-opacity', 0.85);
  map.setLayoutProperty('gfocus', 'visibility', o.clipGroup ? 'visible' : 'none');
  // Gradient heatmap by default; burn-scar pixels take over as you zoom in.
  setRaster(map, 'heat', o.heatUrl, ['interpolate', ['linear'], ['zoom'], 7, op, 9, 0], before, 9);
  setRaster(map, 'fire', o.fireUrl, ['interpolate', ['linear'], ['zoom'], 7, 0, 9, op], before);

  if (setVector(map, 'grp', groupingTilesUrl(o.grouping))) {
    const hover: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false];
    map.addLayer(
      {
        id: 'grp-fill',
        type: 'fill',
        source: 'grp',
        'source-layer': SRC_LAYER,
        paint: {
          'fill-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5,
            ['case', hover, dark ? 0.2 : 0.15, ['coalesce', ['feature-state', 'v'], 0]],
            7,
            ['case', hover, dark ? 0.2 : 0.15, 0],
          ],
        },
      },
      before,
    );
    map.addLayer(
      { id: 'grp-line', type: 'line', source: 'grp', 'source-layer': SRC_LAYER, paint: { 'line-width': 1, 'line-dasharray': [1, 2] } },
      before,
    );
  }
  map.setPaintProperty('grp-fill', 'fill-color', ['case', ['boolean', ['feature-state', 'hover'], false], dark ? '#ffffff' : '#000000', o.paintColor]);
  map.setPaintProperty('grp-line', 'line-color', dark && !sat ? '#666' : '#bbb');
  map.setPaintProperty('grp-line', 'line-opacity', o.values.size ? 0 : dark && !sat ? 0.6 : 1);
  map.setFilter('grp-fill', o.filter);
  map.setFilter('grp-line', o.filter);

  // dimming sits above the grouping lines so parts outside fade; the plain tint stays under the fire rasters
  map.moveLayer('focus', o.dimOutside ? before : ['heat', 'fire', 'grp-fill'].find((id) => map.getLayer(id)));
  // keep the border above fire rasters and grouping lines (they may be (re)added after it)
  map.moveLayer('gfocus', before);
  map.moveLayer('focus-line', before);

  map.removeFeatureState({ source: 'grp', sourceLayer: SRC_LAYER });
  o.values.forEach((v, code) => map.setFeatureState({ source: 'grp', sourceLayer: SRC_LAYER, id: code }, { v }));
}

export function MapView({ s }: { s: AppState }) {
  const el = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [theme] = useTheme();
  const tokens = useTokens();
  const [tip, setTip] = useState<{ x: number; y: number; name: string; parent?: string } | null>(null);
  const overlay = useRef<Overlay>(null);
  const drawing = useRef(false);

  const period = { year: s.year, monthStart: s.monthStart, monthEnd: s.monthEnd, landCover: s.landCover };
  const mapQ = { ...period, territoryType: s.type, territoryCode: s.code };
  const fire = useFireTiles('raster', mapQ);
  const heat = useFireTiles('heatmap', mapQ);
  const clip = useGroupingOptions(s.type, s.code, period).uncoded.includes(s.grouping);
  const rank = useRankingFor(s, period, clip);
  const inside = useInsideCodes(s.type, s.code, s.grouping, clip);
  const bounds = useBounds(s.type, s.code);
  const styleKey = s.basemap === 'satellite' ? 'satellite' : theme;
  const lastStyle = useRef(styleKey);

  // create once
  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      style: STYLES[styleKey],
      center: [118, -2.5],
      zoom: 4,
      // Loose pan limit only; the zoom-out limit is set from the viewport below (a tight box crops on wide screens).
      maxBounds: [
        [75, -45],
        [160, 35],
      ],
      attributionControl: { compact: false },
    });
    // Can't zoom out further than "all of Indonesia fits" (plus a little air), recomputed per viewport size.
    const lockZoom = () => {
      const cam = m.cameraForBounds(INDONESIA, { padding: FIT_PADDING });
      if (cam?.zoom != null) m.setMinZoom(Math.max(cam.zoom - 0.3, 0));
    };
    m.on('load', lockZoom);
    m.on('resize', lockZoom);
    let hovered: number | string | undefined;
    const clearHover = () => {
      if (hovered != null && m.getSource('grp')) m.setFeatureState({ source: 'grp', sourceLayer: SRC_LAYER, id: hovered }, { hover: false });
      hovered = undefined;
    };
    m.on('style.load', () => {
      if (lastStyle.current !== 'satellite') tintBasemap(m, lastStyle.current as 'dark' | 'light');
      if (overlay.current) applyOverlay(m, overlay.current);
    });
    m.on('mousemove', 'grp-fill', (e) => {
      if (drawing.current) return;
      const f = e.features?.[0];
      if (!f) return;
      if (f.id !== hovered) {
        clearHover();
        hovered = f.id;
        m.setFeatureState({ source: 'grp', sourceLayer: SRC_LAYER, id: f.id! }, { hover: true });
      }
      m.getCanvas().style.cursor = 'pointer';
      setTip({ x: e.point.x, y: e.point.y, name: f.properties.name, parent: f.properties.parentLabel });
    });
    m.on('mouseleave', 'grp-fill', () => {
      clearHover();
      if (!drawing.current) m.getCanvas().style.cursor = ''; // keep draw mode's crosshair
      setTip(null);
    });
    m.on('click', 'grp-fill', (e) => {
      if (drawing.current) return;
      const f = e.features?.[0];
      const g = overlay.current?.grouping;
      if (!f || !g) return;
      clearHover();
      setTip(null);
      selectTerritory(g, Number(f.properties.code));
    });
    if (import.meta.env.DEV) Object.assign(window, { __map: m });
    setMap(m);
    return () => m.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // basemap / theme
  useEffect(() => {
    if (!map || lastStyle.current === styleKey) return;
    lastStyle.current = styleKey;
    map.setStyle(STYLES[styleKey]);
  }, [map, styleKey]);

  // overlays
  const rows = rank.data;
  useEffect(() => {
    if (!map) return;
    const values = new Map<number, number>();
    if (s.paint && rows?.length) {
      const max = Math.max(...rows.map((r) => r.value)) || 1;
      rows.forEach((r) => values.set(r.code, (r.value * 0.5) / max + 0.2));
    }
    overlay.current = {
      fireUrl: fire.data?.url,
      heatUrl: heat.data?.url,
      grouping: s.grouping,
      // below country the grouping doesn't change the mask; keeping the url stable avoids reloading it on every switch
      focusUrl: shapeTilesUrl(s.type, s.code, s.type === 'country' ? s.grouping : s.type),
      // derived thematic layer: its features carry no admin codes, so list the ones inside the territory
      filter: clip ? ['in', ['get', 'code'], ['literal', [...(inside ?? [])]]] : selectionFilter(s),
      opacity: s.opacity,
      values,
      theme,
      paintColor: tokens.chart,
      focusColor: tokens.text,
      // nationally the shape tiles of a thematic layer mask everything outside its shapes: dim it so it's clear only they can be opened
      national: s.type === 'country' && ADMIN_TYPES.has(s.grouping),
      dimOutside: clip || (s.type === 'country' && !ADMIN_TYPES.has(s.grouping)),
      clipGroup: s.type !== 'country' && s.grouping !== s.type && !ADMIN_TYPES.has(s.grouping),
    };
    // isStyleLoaded() is also false while tiles load (e.g. mid fly-to), so don't wait on it: apply now, and
    // if the style itself is mid-swap addSource throws and the style.load handler re-applies overlay.current.
    try {
      applyOverlay(map, overlay.current);
    } catch (e) {
      if (import.meta.env.DEV) console.warn('applyOverlay', e); // style loading
    }
  }, [map, fire.data?.url, heat.data?.url, s.grouping, s.type, s.code, s.opacity, s.paint, rows, theme, clip, inside]); // eslint-disable-line react-hooks/exhaustive-deps

  // fly to selected territory
  const box = bounds.data?.geometry.coordinates[0];
  useEffect(() => {
    if (!map || !box) return;
    const xs = box.map((p) => p[0]);
    const ys = box.map((p) => p[1]);
    map.fitBounds(
      [
        [Math.min(...xs), Math.min(...ys)],
        [Math.max(...xs), Math.max(...ys)],
      ],
      { padding: FIT_PADDING, duration: 900 },
    );
  }, [map, box]);

  const loading = fire.isFetching || heat.isFetching;
  return (
    <div className="map-wrap">
      <div ref={el} className="map" />
      {loading && <div className="loader-bar" />}
      {tip && (
        <div className="map-tooltip" style={{ left: tip.x, top: tip.y }}>
          {tip.name}
          {tip.parent && tip.parent !== 'Indonesia' && (
            <>
              <br />
              {tip.parent}
            </>
          )}
        </div>
      )}
      {map && <MapControls map={map} s={s} bbox={box} drawing={drawing} />}
    </div>
  );
}
