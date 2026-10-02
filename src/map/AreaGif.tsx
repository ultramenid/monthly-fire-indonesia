import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type * as maplibregl from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { ImagePlay, PenTool, X } from 'lucide-react';
import { fetchGif } from '../api';
import { useI18n } from '../i18n';
import type { AppState } from '../state';
import { useTheme } from '../hooks';
import { Modal } from '../ui';
import { Dropdown } from './Dropdown';

type GifState = { url?: string; failed?: boolean };

const boxBetween = (corner: maplibregl.LngLat, oppositeCorner: maplibregl.LngLat) => [
  [corner.lng, corner.lat],
  [oppositeCorner.lng, corner.lat],
  [oppositeCorner.lng, oppositeCorner.lat],
  [corner.lng, oppositeCorner.lat],
  [corner.lng, corner.lat],
];

/** Drag a box on the map and Earth Engine renders the fire evolution inside it as a GIF. */
export function AreaGif({ map, state, setDrawing }: { map: maplibregl.Map; state: AppState; setDrawing: (drawing: boolean) => void }) {
  const { labels } = useI18n();
  const [theme] = useTheme();
  const [isDrawMode, setDrawMode] = useState(false);
  const [gif, setGif] = useState<GifState | null>(null);

  useEffect(() => {
    if (!isDrawMode) return;
    setDrawing(true);
    map.dragPan.disable();
    map.getCanvas().style.cursor = '';
    map.getContainer().classList.add('maplibregl-crosshair');

    const showBox = (coordinates: number[][] | null) => {
      const data: FeatureCollection = {
        type: 'FeatureCollection',
        features: coordinates ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coordinates] } }] : [],
      };
      const source = map.getSource('draw') as maplibregl.GeoJSONSource | undefined;
      if (source) return source.setData(data);
      map.addSource('draw', { type: 'geojson', data });
      map.addLayer({ id: 'draw-fill', type: 'fill', source: 'draw', paint: { 'fill-color': '#e84130', 'fill-opacity': 0.15 } });
      map.addLayer({ id: 'draw-line', type: 'line', source: 'draw', paint: { 'line-color': '#e84130', 'line-width': 2, 'line-dasharray': [2, 1] } });
    };

    let dragStart: maplibregl.LngLat | null = null;
    const onMouseDown = (event: maplibregl.MapMouseEvent) => {
      dragStart = event.lngLat;
    };
    const onMouseMove = (event: maplibregl.MapMouseEvent) => {
      if (dragStart) showBox(boxBetween(dragStart, event.lngLat));
    };
    const onMouseUp = async (event: maplibregl.MapMouseEvent) => {
      if (!dragStart) return;
      const coordinates = boxBetween(dragStart, event.lngLat);
      dragStart = null;
      setDrawMode(false);
      const isTooSmall = Math.abs(coordinates[0][0] - coordinates[1][0]) < 1e-4 || Math.abs(coordinates[0][1] - coordinates[2][1]) < 1e-4;
      if (isTooSmall) return showBox(null);

      setGif({});
      try {
        const { url } = await fetchGif({
          coordinates,
          theme,
          year: state.year!,
          monthStart: state.monthStart!,
          monthEnd: state.monthEnd!,
          landCover: state.landCover,
        });
        // Earth Engine renders the GIF during this request (10–20s), so fetch it here to show "generating" until it's ready.
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${response.status} gif`);
        setGif({ url: URL.createObjectURL(await response.blob()) });
      } catch {
        setGif({ failed: true });
      }
      showBox(null);
    };

    map.on('mousedown', onMouseDown);
    map.on('mousemove', onMouseMove);
    map.on('mouseup', onMouseUp);
    return () => {
      map.off('mousedown', onMouseDown);
      map.off('mousemove', onMouseMove);
      map.off('mouseup', onMouseUp);
      map.dragPan.enable();
      map.getContainer().classList.remove('maplibregl-crosshair');
      // let the click that ends the drag pass before territory clicks work again
      setTimeout(() => setDrawing(false), 50);
    };
  }, [isDrawMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeGif = () => {
    if (gif?.url) URL.revokeObjectURL(gif.url);
    setGif(null);
  };

  return (
    <>
      <Dropdown
        trigger={(isOpen, toggle) => (
          <button className="icon-btn bg-bg" aria-label={labels.selectArea} aria-pressed={isOpen || isDrawMode} onClick={toggle}>
            <ImagePlay size={20} />
          </button>
        )}
      >
        {(close) => (
          <div className="pop top-[46px] right-0 w-[324px] px-3 pt-4 pb-3">
            <header className="flex items-center justify-between font-bold text-fg-2">
              {labels.selectArea}
              <button className="icon-btn size-7 text-primary" aria-label={labels.close} onClick={close}>
                <X size={18} />
              </button>
            </header>
            <p className="my-4 text-xs text-fg-2">{labels.selectAreaDesc}</p>
            <button
              className="inline-flex h-[38px] items-center gap-2 rounded-lg border px-3 font-bold"
              onClick={() => {
                setDrawMode(true);
                close();
              }}
            >
              <PenTool size={16} className="text-accent-icon" /> {labels.newSelection}
            </button>
          </div>
        )}
      </Dropdown>

      {/* rendered into the map wrapper so the hint is centered over the whole map */}
      {isDrawMode &&
        createPortal(
          <div className="absolute top-[72px] left-1/2 z-12 -translate-x-1/2 rounded-full bg-bg px-4 py-2 font-semibold text-fg-2">
            {labels.drawHint}
            <button className="ml-2 text-primary" onClick={() => setDrawMode(false)}>
              {labels.cancel}
            </button>
          </div>,
          map.getContainer().parentElement!,
        )}

      {gif && (
        <Modal title={labels.selectArea} onClose={closeGif}>
          {gif.url ? (
            <>
              <img className="mx-auto mb-3 block max-h-[60vh] max-w-full rounded-lg" src={gif.url} alt="Fire scar evolution" />
              <a className="inline-flex h-8 items-center rounded bg-primary-strong px-3 font-bold text-white" href={gif.url} download="fire-evolution.gif">
                {labels.download}
              </a>
            </>
          ) : (
            <p className="empty">{gif.failed ? labels.error : labels.generating}</p>
          )}
        </Modal>
      )}
    </>
  );
}
