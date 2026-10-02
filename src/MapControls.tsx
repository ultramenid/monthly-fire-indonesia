import { useEffect, useRef, useState, type RefObject } from 'react';
import type * as maplibregl from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import {
  CalendarDays,
  Check,
  ChevronDown,
  Crosshair,
  Droplet,
  ImagePlay,
  Map as MapIcon,
  Maximize,
  Minus,
  PenTool,
  Plus,
  ScanSearch,
  SendHorizontal,
  Share2,
  TextSearch,
  X,
} from 'lucide-react';
import { fetchGif, useGroupingOptions, useMonths, useTerritoryLandCovers, useYears } from './api';
import { useI18n } from './i18n';
import { defaultGrouping, setState, type AppState } from './state';
import { Modal, copyLink, useDismiss, useTheme } from './ui';

type Props = { map: maplibregl.Map; s: AppState; bbox?: number[][]; drawing: RefObject<boolean> };
type PopId = 'grouping' | 'landcover' | 'basemap' | 'opacity' | 'area' | 'coords' | 'year' | null;

export function MapControls({ map, s, bbox, drawing }: Props) {
  const { t, name, month } = useI18n();
  const [theme] = useTheme();
  const [pop, setPop] = useState<PopId>(null);
  const close = () => setPop(null);
  const toggle = (p: PopId) => setPop((cur) => (cur === p ? null : p));

  const landCovers = useTerritoryLandCovers(s.type, s.code).data ?? [];
  const years = useYears().data ?? [];
  const months = useMonths(s.year).data ?? [];

  const topRef = useDismiss<HTMLDivElement>(pop === 'grouping' || pop === 'landcover' || pop === 'basemap' || pop === 'opacity' || pop === 'area', close);
  const rightRef = useDismiss<HTMLDivElement>(pop === 'coords', close);
  const yearRef = useDismiss<HTMLDivElement>(pop === 'year', close);

  // map-derived UI state
  const [bearing, setBearing] = useState(0);
  const [center, setCenter] = useState(() => map.getCenter());
  const [showCross, setShowCross] = useState(false);
  useEffect(() => {
    const onMove = () => {
      setCenter(map.getCenter());
      setBearing(map.getBearing());
    };
    map.on('move', onMove);
    return () => void map.off('move', onMove);
  }, [map]);

  const fit = () => {
    if (!bbox) return;
    const xs = bbox.map((p) => p[0]);
    const ys = bbox.map((p) => p[1]);
    map.fitBounds([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], { padding: 60 });
  };

  const fullscreen = () => {
    const el = map.getContainer().parentElement!;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  // ---- area selection → fire evolution GIF ----
  const [drawMode, setDrawMode] = useState(false);
  const [gif, setGif] = useState<{ url?: string; error?: boolean } | null>(null);
  useEffect(() => {
    if (!drawMode) return;
    drawing.current = true;
    map.dragPan.disable();
    // MapLibre's own class wins over its grab/grabbing/pointer cursors, including mid-drag
    map.getCanvas().style.cursor = '';
    map.getContainer().classList.add('maplibregl-crosshair');
    let start: maplibregl.LngLat | null = null;
    const ring = (a: maplibregl.LngLat, b: maplibregl.LngLat) => [
      [a.lng, a.lat],
      [b.lng, a.lat],
      [b.lng, b.lat],
      [a.lng, b.lat],
      [a.lng, a.lat],
    ];
    const show = (coords: number[][] | null) => {
      const data: FeatureCollection = {
        type: 'FeatureCollection',
        features: coords ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } }] : [],
      };
      const src = map.getSource('draw') as maplibregl.GeoJSONSource | undefined;
      if (src) return src.setData(data);
      map.addSource('draw', { type: 'geojson', data });
      map.addLayer({ id: 'draw-fill', type: 'fill', source: 'draw', paint: { 'fill-color': '#e84130', 'fill-opacity': 0.15 } });
      map.addLayer({ id: 'draw-line', type: 'line', source: 'draw', paint: { 'line-color': '#e84130', 'line-width': 2, 'line-dasharray': [2, 1] } });
    };
    const down = (e: maplibregl.MapMouseEvent) => (start = e.lngLat);
    const move = (e: maplibregl.MapMouseEvent) => start && show(ring(start, e.lngLat));
    const up = async (e: maplibregl.MapMouseEvent) => {
      if (!start) return;
      const coords = ring(start, e.lngLat);
      start = null;
      setDrawMode(false);
      if (Math.abs(coords[0][0] - coords[1][0]) < 1e-4 || Math.abs(coords[0][1] - coords[2][1]) < 1e-4) return show(null);
      setGif({});
      try {
        const r = await fetchGif({
          coordinates: coords,
          theme,
          year: s.year!,
          monthStart: s.monthStart!,
          monthEnd: s.monthEnd!,
          landCover: s.landCover,
        });
        // EE renders on this request (~10-20s); fetch as a blob so "generating" covers it, errors surface, and download saves a file
        const res = await fetch(r.url);
        if (!res.ok) throw new Error(`${res.status} gif`);
        setGif({ url: URL.createObjectURL(await res.blob()) });
      } catch {
        setGif({ error: true });
      }
      show(null);
    };
    map.on('mousedown', down);
    map.on('mousemove', move);
    map.on('mouseup', up);
    return () => {
      map.off('mousedown', down);
      map.off('mousemove', move);
      map.off('mouseup', up);
      map.dragPan.enable();
      map.getContainer().classList.remove('maplibregl-crosshair');
      // let the click that ends the drag pass before re-enabling territory clicks
      setTimeout(() => (drawing.current = false), 50);
    };
  }, [drawMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- months slider ----
  // drag locally, commit on release: every committed change refetches stats + Earth Engine tiles
  const [draft, setDraft] = useState<[number, number] | null>(null);
  const [iStart, iEnd] = draft ?? [Math.max(0, months.indexOf(s.monthStart ?? -1)), Math.max(0, months.indexOf(s.monthEnd ?? -1))];
  // which thumb this drag moves; decided by direction when both thumbs sit on the same month
  const role = useRef<'start' | 'end' | null>(null);
  const move = (which: 'start' | 'end', v: number) => {
    if (!role.current) {
      if (iStart !== iEnd) role.current = which;
      else if (v === iStart) return;
      else role.current = v < iStart ? 'start' : 'end';
    }
    setDraft(role.current === 'start' ? [Math.min(v, iEnd), iEnd] : [iStart, Math.max(v, iStart)]);
  };
  const commit = () => {
    role.current = null;
    if (!draft) return;
    setDraft(null);
    if (months[draft[0]] !== s.monthStart || months[draft[1]] !== s.monthEnd) setState({ monthStart: months[draft[0]], monthEnd: months[draft[1]] });
  };
  const frac = (i: number) => (months.length > 1 ? i / (months.length - 1) : 0);
  // a native thumb's center travels [12px, width - 12px], so place fill/ticks on that span
  const at = (i: number) => `calc(12px + (100% - 24px) * ${frac(i)})`;
  // release anywhere ends the drag (the pointer often leaves the slider before letting go)
  useEffect(() => {
    if (!draft) return;
    addEventListener('pointerup', commit);
    return () => removeEventListener('pointerup', commit);
  });
  const slider = { min: 0, max: months.length - 1, onKeyUp: commit, onBlur: commit };

  const [coordText, setCoordText] = useState('');
  const flyTo = (lat: number, lng: number) =>
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 9) });

  // grouping: drives the map's sub-territory layer and the ranking. Offers every admin level below the territory
  // (drilling still resets to the next one) and then this area's thematic layers.
  const opts = useGroupingOptions(s.type, s.code, { year: s.year, monthStart: s.monthStart, monthEnd: s.monthEnd, landCover: s.landCover });
  const below: string[] = [];
  for (let g = s.type; defaultGrouping(g) !== g; g = defaultGrouping(g)) below.push(defaultGrouping(g));
  const order = Object.keys(opts.names);
  const thematic = [...opts.backed, ...opts.derived].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  // a thematic territory has no admin levels below it; it groups by itself
  const groupings = [...new Set([...(below.length ? below : [s.type]), ...thematic, s.grouping])];
  const groupName = (g: string) => name(opts.names[g] as never) || g;

  const lcLabel = s.landCover ? name(landCovers.find((l) => l.id === s.landCover)) : t.allLandCover;

  return (
    <>
      {/* ---------- top ---------- */}
      <div className="map-top" ref={topRef}>
        <div style={{ position: 'relative' }}>
          <button className="pill" aria-expanded={pop === 'grouping'} disabled={groupings.length < 2} onClick={() => toggle('grouping')}>
            {t.groupedBy} {groupName(s.grouping)} {groupings.length > 1 && <ChevronDown size={16} />}
          </button>
          {pop === 'grouping' && (
            <div className="pop menu" style={{ top: 42, left: 0, minWidth: '100%' }} role="menu">
              {groupings.map((g) => (
                <button
                  key={g}
                  className="menu-item"
                  role="menuitemradio"
                  aria-checked={g === s.grouping}
                  onClick={() => (setState({ grouping: g }), close())}
                >
                  {groupName(g)} {g === s.grouping && <Check size={16} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ position: 'relative' }}>
          <button className={`pill${s.landCover ? ' active' : ''}`} aria-expanded={pop === 'landcover'} onClick={() => toggle('landcover')}>
            {t.showing} {lcLabel} <ChevronDown size={16} />
          </button>
          {pop === 'landcover' && (
            <div className="pop menu" style={{ top: 42, left: 0, minWidth: '100%' }} role="menu">
              {[{ id: undefined, label: t.allLandCover[0].toUpperCase() + t.allLandCover.slice(1) /* lowercase in i18n for the "Showing …" pill */ }, ...landCovers.map((l) => ({ id: l.id, label: name(l) }))].map((o) => (
                <button
                  key={o.id ?? 'all'}
                  className="menu-item"
                  role="menuitemradio"
                  aria-checked={o.id === s.landCover}
                  onClick={() => (setState({ landCover: o.id }), close())}
                >
                  {o.label} {o.id === s.landCover && <Check size={16} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ position: 'relative' }}>
          <button className="icon-btn ctrl" aria-label={t.basemap} aria-pressed={pop === 'basemap'} onClick={() => toggle('basemap')}>
            <MapIcon size={20} />
          </button>
          {pop === 'basemap' && (
            <div className="pop" style={{ top: 46, right: 0, width: 140, paddingBottom: 6 }}>
              <div className="pop-title">{t.basemap}</div>
              {(['default', 'satellite'] as const).map((b) => (
                <label key={b} className="radio">
                  <input type="radio" name="basemap" checked={s.basemap === b} onChange={() => setState({ basemap: b })} />
                  {b === 'satellite' ? t.satellite : theme === 'dark' ? t.dark : t.light}
                </label>
              ))}
            </div>
          )}
        </div>
        <div style={{ position: 'relative' }}>
          <button className="icon-btn ctrl danger" aria-label={t.opacity} aria-pressed={pop === 'opacity'} onClick={() => toggle('opacity')}>
            <Droplet size={20} />
          </button>
          {pop === 'opacity' && (
            <div className="pop opacity-pop" style={{ right: -44 }}>
              <label>
                {t.opacity}
                <input type="range" min={0} max={100} value={s.opacity} onChange={(e) => setState({ opacity: +e.target.value })} />
              </label>
              <output>{s.opacity}</output>
            </div>
          )}
        </div>
        <div style={{ position: 'relative' }}>
          <button className="icon-btn ctrl" aria-label={t.selectArea} aria-pressed={pop === 'area' || drawMode} onClick={() => toggle('area')}>
            <ImagePlay size={20} />
          </button>
          {pop === 'area' && (
            <div className="pop area-pop">
              <header>
                {t.selectArea}
                <button className="icon-btn" style={{ width: 28, height: 28, color: 'var(--primary)' }} aria-label={t.close} onClick={close}>
                  <X size={18} />
                </button>
              </header>
              <p>{t.selectAreaDesc}</p>
              <button className="btn outline" onClick={() => (setDrawMode(true), close())}>
                <PenTool size={16} color="var(--accent-icon)" /> {t.newSelection}
              </button>
            </div>
          )}
        </div>
      </div>

      {drawMode && (
        <div className="draw-hint">
          {t.drawHint}{' '}
          <button style={{ color: 'var(--primary)', marginLeft: 8 }} onClick={() => setDrawMode(false)}>
            {t.cancel}
          </button>
        </div>
      )}

      {/* ---------- right ---------- */}
      <div className="map-right" ref={rightRef}>
        <button className="icon-btn ctrl compass" aria-label={t.resetNorth} onClick={() => map.resetNorthPitch()} style={{ transform: `rotate(${-bearing}deg)` }}>
          N
        </button>
        <div className="zoom-group">
          <button className="icon-btn" aria-label={t.zoomIn} onClick={() => map.zoomIn()}>
            <Plus size={20} />
          </button>
          <button className="icon-btn" aria-label={t.zoomOut} onClick={() => map.zoomOut()}>
            <Minus size={20} />
          </button>
        </div>
        <div style={{ position: 'relative' }}>
          <button className="icon-btn ctrl" aria-label={t.searchCoords} aria-pressed={pop === 'coords'} onClick={() => toggle('coords')}>
            <TextSearch size={20} />
          </button>
          {pop === 'coords' && (
            <form
              className="pop side-pop"
              style={{ top: -6 }}
              onSubmit={(e) => {
                e.preventDefault();
                const [lat, lng] = coordText.split(/[,\s]+/).map(Number);
                flyTo(lat, lng);
              }}
            >
              <input autoFocus placeholder={t.coordsPlaceholder} aria-label={t.searchCoords} value={coordText} onChange={(e) => setCoordText(e.target.value)} />
              <button className="send-btn" aria-label={t.search}>
                <SendHorizontal size={16} />
              </button>
            </form>
          )}
        </div>
        <button className="icon-btn ctrl" aria-label={t.fitTerritory} onClick={fit}>
          <ScanSearch size={20} />
        </button>
        <button className="icon-btn ctrl" aria-label={t.share} onClick={() => copyLink(t.linkCopied)}>
          <Share2 size={20} />
        </button>
        <button className="icon-btn ctrl" aria-label={t.fullscreen} onClick={fullscreen}>
          <Maximize size={20} />
        </button>
      </div>

      {showCross && (
        <div className="center-cross">
          <Plus size={18} />
        </div>
      )}

      {/* ---------- bottom ---------- */}
      <div className="map-bottom">
        <div className="time-bar" ref={yearRef}>
          <button className="year-btn" aria-expanded={pop === 'year'} onClick={() => toggle('year')}>
            {s.year ?? '—'} <ChevronDown size={16} />
          </button>
          {pop === 'year' && (
            <div className="pop year-pop" role="menu" aria-label={t.selectYear}>
              <div className="pop-title">{t.selectYear}</div>
              <div className="year-grid">
                {years.map((y) => (
                  <button
                    key={y}
                    role="menuitemradio"
                    aria-checked={y === s.year}
                    onClick={() => {
                      if (y !== s.year) setState({ year: y, monthStart: undefined, monthEnd: undefined });
                      close();
                    }}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </div>
          )}
          <span className="vsep" />
          <span className="months-label">
            <CalendarDays size={20} />
            {months.length > 0 && month(months[iStart])}
            {iEnd !== iStart && <> – {month(months[iEnd])}</>}
          </span>
          <div className="range">
            <div className="track" />
            <div className="fill" style={{ left: at(iStart), width: `calc((100% - 24px) * ${frac(iEnd) - frac(iStart)})` }} />
            {months.map((m, i) => (
              <div key={m} className="tick" style={{ left: at(i) }} />
            ))}
            {months.length > 0 && (
              <>
                <input
                  type="range"
                  aria-label="Start month"
                  {...slider}
                  value={iStart}
                  onChange={(e) => move('start', +e.target.value)}
                />
                <input
                  type="range"
                  aria-label="End month"
                  {...slider}
                  value={iEnd}
                  onChange={(e) => move('end', +e.target.value)}
                />
              </>
            )}
          </div>
        </div>

        <div className="coords">
          <button className="icon-btn" aria-label={t.centerMarker} aria-pressed={showCross} onClick={() => setShowCross((v) => !v)}>
            <Crosshair size={20} />
          </button>
          <label>
            {t.lat}
            <input
              aria-label="Latitude"
              key={`lat${center.lat.toFixed(2)}`}
              defaultValue={center.lat.toFixed(2)}
              onKeyDown={(e) => e.key === 'Enter' && flyTo(+e.currentTarget.value, center.lng)}
            />
          </label>
          <label>
            {t.lng}
            <input
              aria-label="Longitude"
              key={`lng${center.lng.toFixed(2)}`}
              defaultValue={center.lng.toFixed(2)}
              onKeyDown={(e) => e.key === 'Enter' && flyTo(center.lat, +e.currentTarget.value)}
            />
          </label>
        </div>
      </div>

      {gif && (
        <Modal title={t.selectArea} onClose={() => (gif.url && URL.revokeObjectURL(gif.url), setGif(null))}>
          {gif.url ? (
            <>
              <img className="gif-img" src={gif.url} alt="Fire scar evolution" />
              <a className="btn primary" style={{ display: 'inline-flex', alignItems: 'center' }} href={gif.url} download="fire-evolution.gif">
                {t.download}
              </a>
            </>
          ) : gif.error ? (
            <p className="empty">{t.error}</p>
          ) : (
            <p className="empty">{t.generating}</p>
          )}
        </Modal>
      )}
    </>
  );
}
