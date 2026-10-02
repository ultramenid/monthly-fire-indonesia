import { useCallback, useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useBounds, useFireTiles, useGroupingOptions, useInsideCodes, useRankingFor, shapeTilesUrl } from '../api';
import { bboxOf } from '../lib/geo';
import { ADMIN_TYPES, selectTerritory, type AppState } from '../state';
import { useTheme, useTokens } from '../hooks';
import { MapControls } from './MapControls';
import { FIT_PADDING, INDONESIA_BOUNDS, SOURCE_LAYER, STYLES, applyOverlay, selectionFilter, tintBasemap, type Overlay } from './overlay';

type Tooltip = { x: number; y: number; name: string; parentName?: string };

export function MapView({ state }: { state: AppState }) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [theme] = useTheme();
  const tokens = useTokens();
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const currentOverlay = useRef<Overlay>(null);
  const isDrawing = useRef(false);
  // AreaGif owns when drawing starts/ends; the ref stays here so map handlers read it without re-binding
  const setDrawing = useCallback((drawing: boolean) => { isDrawing.current = drawing; }, []);

  const period = { year: state.year, monthStart: state.monthStart, monthEnd: state.monthEnd, landCover: state.landCover };
  const tileQuery = { ...period, territoryType: state.type, territoryCode: state.code };
  const fireTiles = useFireTiles('raster', tileQuery);
  const heatTiles = useFireTiles('heatmap', tileQuery);
  const isDerivedLayer = useGroupingOptions(state.type, state.code, period).uncoded.includes(state.grouping);
  const ranking = useRankingFor(state, period, isDerivedLayer);
  const insideCodes = useInsideCodes(state.type, state.code, state.grouping, isDerivedLayer);
  const bounds = useBounds(state.type, state.code);
  const styleKey = state.basemap === 'satellite' ? 'satellite' : theme;
  const lastStyleKey = useRef(styleKey);

  // Create the map once.
  useEffect(() => {
    const mapInstance = new maplibregl.Map({
      container: container.current!,
      style: STYLES[styleKey],
      center: [118, -2.5],
      zoom: 4,
      maxBounds: [
        [75, -45],
        [160, 35],
      ],
      attributionControl: { compact: false },
    });

    // Don't zoom out further than "all of Indonesia fits", recalculated when the window resizes.
    const limitZoomOut = () => {
      const camera = mapInstance.cameraForBounds(INDONESIA_BOUNDS, { padding: FIT_PADDING });
      if (camera?.zoom != null) mapInstance.setMinZoom(Math.max(camera.zoom - 0.3, 0));
    };
    mapInstance.on('load', limitZoomOut);
    mapInstance.on('resize', limitZoomOut);

    // A new basemap style wipes our layers, so add them back.
    mapInstance.on('style.load', () => {
      if (lastStyleKey.current !== 'satellite') tintBasemap(mapInstance, lastStyleKey.current as 'dark' | 'light');
      if (currentOverlay.current) applyOverlay(mapInstance, currentOverlay.current);
    });

    let hoveredId: number | string | undefined;
    const clearHover = () => {
      if (hoveredId != null && mapInstance.getSource('grp')) {
        mapInstance.setFeatureState({ source: 'grp', sourceLayer: SOURCE_LAYER, id: hoveredId }, { hover: false });
      }
      hoveredId = undefined;
    };
    mapInstance.on('mousemove', 'grp-fill', (event) => {
      const feature = event.features?.[0];
      if (isDrawing.current || !feature) return;
      if (feature.id !== hoveredId) {
        clearHover();
        hoveredId = feature.id;
        mapInstance.setFeatureState({ source: 'grp', sourceLayer: SOURCE_LAYER, id: feature.id! }, { hover: true });
      }
      mapInstance.getCanvas().style.cursor = 'pointer';
      setTooltip({ x: event.point.x, y: event.point.y, name: feature.properties.name, parentName: feature.properties.parentLabel });
    });
    mapInstance.on('mouseleave', 'grp-fill', () => {
      clearHover();
      if (!isDrawing.current) mapInstance.getCanvas().style.cursor = '';
      setTooltip(null);
    });
    mapInstance.on('click', 'grp-fill', (event) => {
      const feature = event.features?.[0];
      const grouping = currentOverlay.current?.grouping;
      if (isDrawing.current || !feature || !grouping) return;
      clearHover();
      setTooltip(null);
      selectTerritory(grouping, Number(feature.properties.code));
    });

    setMap(mapInstance);
    return () => mapInstance.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Switch basemap when the theme or basemap choice changes.
  useEffect(() => {
    if (!map || lastStyleKey.current === styleKey) return;
    lastStyleKey.current = styleKey;
    map.setStyle(STYLES[styleKey]);
  }, [map, styleKey]);

  // Draw fire layers, territory outline and sub-territories.
  const rankingRows = ranking.data;
  useEffect(() => {
    if (!map) return;
    const paintValues = new Map<number, number>();
    if (state.paint && rankingRows?.length) {
      const maxValue = Math.max(...rankingRows.map((row) => row.value)) || 1;
      rankingRows.forEach((row) => paintValues.set(row.code, (row.value * 0.5) / maxValue + 0.2));
    }
    const isNational = state.type === 'country';
    const isAdminGrouping = ADMIN_TYPES.has(state.grouping);
    currentOverlay.current = {
      fireUrl: fireTiles.data?.url,
      heatUrl: heatTiles.data?.url,
      grouping: state.grouping,
      // below country the mask only depends on the territory, so keep the URL stable to avoid reloading it
      focusUrl: shapeTilesUrl(state.type, state.code, isNational ? state.grouping : state.type),
      filter: isDerivedLayer ? ['in', ['get', 'code'], ['literal', [...(insideCodes ?? [])]]] : selectionFilter(state),
      opacity: state.opacity,
      paintValues,
      theme,
      paintColor: tokens.chart,
      focusColor: tokens.text,
      national: isNational && isAdminGrouping,
      dimOutside: isDerivedLayer || (isNational && !isAdminGrouping),
      clipGroup: !isNational && state.grouping !== state.type && !isAdminGrouping,
    };
    // While a new style is loading this throws; the 'style.load' handler above applies it afterwards.
    try {
      applyOverlay(map, currentOverlay.current);
    } catch {
      // style still loading
    }
  }, [map, fireTiles.data?.url, heatTiles.data?.url, state.grouping, state.type, state.code, state.opacity, state.paint, rankingRows, theme, isDerivedLayer, insideCodes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fly to the selected territory.
  const boundsRing = bounds.data?.geometry.coordinates[0];
  useEffect(() => {
    if (map && boundsRing) map.fitBounds(bboxOf(boundsRing), { padding: FIT_PADDING, duration: 900 });
  }, [map, boundsRing]);

  const isLoadingTiles = fireTiles.isFetching || heatTiles.isFetching;
  return (
    <div className="relative min-w-0 overflow-hidden mobile:h-[70vh]">
      {/* `!` because maplibre-gl.css sets position: relative on this element */}
      <div ref={container} className="absolute! inset-0" />
      {isLoadingTiles && <div className="loader-bar" />}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-15 translate-x-2 translate-y-2 rounded-xs bg-surface-2 px-1.5 py-1 text-xs leading-[1.4] whitespace-nowrap text-fg-2"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.name}
          {tooltip.parentName && tooltip.parentName !== 'Indonesia' && (
            <>
              <br />
              {tooltip.parentName}
            </>
          )}
        </div>
      )}
      {map && <MapControls map={map} state={state} boundsRing={boundsRing} setDrawing={setDrawing} />}
    </div>
  );
}
