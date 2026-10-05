import { useEffect, useState } from 'react';
import type * as maplibregl from 'maplibre-gl';
import { ChevronDown, Crosshair, Droplet, Map as MapIcon, Maximize, Minus, Plus, ScanSearch, SendHorizontal, Share2, TextSearch } from 'lucide-react';
import { useGroupingOptions, useTerritoryLandCovers } from '../api';
import { useI18n } from '../i18n';
import { bboxOf } from '../lib/geo';
import { defaultGrouping, setState, type AppState } from '../state';
import { useTheme } from '../hooks';
import { copyLink } from '../lib/browser';
import { AreaGif } from './AreaGif';
import { Dropdown, RadioMenu } from './Dropdown';
import { TimeBar } from './TimeBar';

type Props = { map: maplibregl.Map; state: AppState; boundsRing?: number[][]; setDrawing: (drawing: boolean) => void };

const pill =
  'inline-flex h-[37px] items-center gap-1.5 rounded-full border border-transparent bg-bg px-3 font-bold whitespace-nowrap text-fg-2 focus-visible:border-border focus-visible:outline-none mobile:max-w-full mobile:overflow-hidden';
const mapButton = 'icon-btn bg-bg';

/** All floating controls on the map: filters (top), navigation (right), time and coordinates (bottom). */
export function MapControls({ map, state, boundsRing, setDrawing }: Props) {
  const { labels, name } = useI18n();
  const [theme] = useTheme();
  const landCovers = useTerritoryLandCovers(state.type, state.code).data ?? [];

  const [bearing, setBearing] = useState(0);
  const [center, setCenter] = useState(() => map.getCenter());
  const [showCenterMarker, setShowCenterMarker] = useState(false);
  useEffect(() => {
    const onMove = () => {
      setCenter(map.getCenter());
      setBearing(map.getBearing());
    };
    map.on('move', onMove);
    return () => {
      map.off('move', onMove);
    };
  }, [map]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else map.getContainer().parentElement!.requestFullscreen?.();
  };

  const [coordinateInput, setCoordinateInput] = useState('');
  const flyTo = (lat: number, lng: number) => {
    const isValid = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    if (isValid) map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 9) });
  };

  // Grouping options: every admin level below the territory, then the thematic layers with data here.
  const period = { year: state.year, monthStart: state.monthStart, monthEnd: state.monthEnd, landCover: state.landCover };
  const groupingOptions = useGroupingOptions(state.type, state.code, period);
  const adminLevelsBelow: string[] = [];
  for (let level = state.type; defaultGrouping(level) !== level; level = defaultGrouping(level)) adminLevelsBelow.push(defaultGrouping(level));
  const layerOrder = Object.keys(groupingOptions.names);
  const thematicLayers = groupingOptions.backed.toSorted((first, second) => layerOrder.indexOf(first) - layerOrder.indexOf(second));
  // a thematic territory (e.g. a national park) has no admin levels below it, so it groups by itself
  const groupings = [...new Set([...(adminLevelsBelow.length ? adminLevelsBelow : [state.type]), ...thematicLayers])];
  // the active grouping has no API numbers here (other period, old link…): go back to the default
  const isGroupingUnavailable = groupingOptions.isSettled && !groupings.includes(state.grouping);
  useEffect(() => {
    if (isGroupingUnavailable) setState({ grouping: defaultGrouping(state.type) });
  }, [isGroupingUnavailable, state.type]);
  const groupingName = (grouping: string) => name(groupingOptions.names[grouping] as never) || grouping;
  // at country level the default grouping (islands) shows the generic "Region" label
  const isDefaultNationalGrouping = state.type === 'country' && state.grouping === defaultGrouping(state.type);

  const landCoverLabel = state.landCover ? name(landCovers.find((landCover) => landCover.id === state.landCover)) : labels.landCoverLabel;

  return (
    <>
      <div className="absolute top-6 right-4 z-10 flex gap-2 mobile:left-4 mobile:flex-wrap mobile:justify-end">
        <Dropdown
          trigger={(isOpen, toggle) => (
            <button className={pill} aria-expanded={isOpen} disabled={groupings.length < 2} onClick={toggle}>
              {labels.by} {isDefaultNationalGrouping ? labels.groupingTitle : groupingName(state.grouping)}
              {groupings.length > 1 && <ChevronDown size={16} />}
            </button>
          )}
        >
          {(close) => (
            <RadioMenu
              heading={labels.groupingTitle}
              options={groupings.map((grouping) => ({ value: grouping, label: groupingName(grouping) }))}
              selected={state.grouping}
              onSelect={(grouping) => {
                setState({ grouping });
                close();
              }}
            />
          )}
        </Dropdown>

        <Dropdown
          trigger={(isOpen, toggle) => (
            <button className={`${pill} ${state.landCover ? 'border-primary' : ''}`} aria-expanded={isOpen} onClick={toggle}>
              {landCoverLabel} <ChevronDown size={16} />
            </button>
          )}
        >
          {(close) => (
            <RadioMenu<number | undefined>
              options={[{ value: undefined, label: labels.landCoverLabel }, ...landCovers.map((landCover) => ({ value: landCover.id, label: name(landCover) }))]}
              selected={state.landCover}
              onSelect={(landCover) => {
                setState({ landCover });
                close();
              }}
            />
          )}
        </Dropdown>

        <Dropdown
          trigger={(isOpen, toggle) => (
            <button className={mapButton} aria-label={labels.basemap} aria-pressed={isOpen} onClick={toggle}>
              <MapIcon size={20} />
            </button>
          )}
        >
          {() => (
            <div className="pop top-[46px] right-0 w-[140px] pb-1.5">
              <div className="px-2.5 pt-2 pb-1 text-xs font-bold text-fg-2">{labels.basemap}</div>
              {(['default', 'satellite'] as const).map((basemap) => (
                <label key={basemap} className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-fg-2">
                  <input
                    className="m-0 size-4 accent-primary"
                    type="radio"
                    name="basemap"
                    checked={state.basemap === basemap}
                    onChange={() => setState({ basemap })}
                  />
                  {basemap === 'satellite' ? labels.satellite : theme === 'dark' ? labels.dark : labels.light}
                </label>
              ))}
            </div>
          )}
        </Dropdown>

        <Dropdown
          trigger={(isOpen, toggle) => (
            <button
              className={`${mapButton} aria-pressed:bg-primary-strong aria-pressed:text-white aria-pressed:shadow-none`}
              aria-label={labels.opacity}
              aria-pressed={isOpen}
              onClick={toggle}
            >
              <Droplet size={20} />
            </button>
          )}
        >
          {() => (
            <div className="pop top-[46px] -right-11 w-[170px] p-3 text-xs text-fg-2">
              <label>
                {labels.opacity}
                <input
                  className="w-full accent-primary"
                  type="range"
                  min={0}
                  max={100}
                  value={state.opacity}
                  onChange={(event) => setState({ opacity: Number(event.target.value) })}
                />
              </label>
              <output className="block text-right font-bold">{state.opacity}</output>
            </div>
          )}
        </Dropdown>

        <AreaGif map={map} state={state} setDrawing={setDrawing} />
      </div>

      <div className="absolute right-4 bottom-[72px] z-10 flex flex-col gap-2">
        <button
          className={`${mapButton} relative text-xs font-bold`}
          aria-label={labels.resetNorth}
          onClick={() => map.resetNorthPitch()}
          style={{ transform: `rotate(${-bearing}deg)` }}
        >
          <span className="absolute top-[3px] left-1/2 -translate-x-1/2 border-x-[3px] border-b-[5px] border-x-transparent border-b-primary" />N
        </button>
        <div className="flex flex-col rounded-full bg-bg">
          <button className="icon-btn rounded-none rounded-t-full" aria-label={labels.zoomIn} onClick={() => map.zoomIn()}>
            <Plus size={20} />
          </button>
          <button className="icon-btn rounded-none rounded-b-full" aria-label={labels.zoomOut} onClick={() => map.zoomOut()}>
            <Minus size={20} />
          </button>
        </div>
        <Dropdown
          trigger={(isOpen, toggle) => (
            <button className={mapButton} aria-label={labels.searchCoords} aria-pressed={isOpen} onClick={toggle}>
              <TextSearch size={20} />
            </button>
          )}
        >
          {() => (
            <form
              className="pop -top-1.5 right-11 flex w-[270px] items-center gap-2 p-2"
              onSubmit={(event) => {
                event.preventDefault();
                const [lat, lng] = coordinateInput.split(/[,\s]+/).map(Number);
                flyTo(lat, lng);
              }}
            >
              <input
                className="h-8 min-w-0 flex-1 rounded-full border bg-surface px-3"
                autoFocus
                placeholder={labels.coordsPlaceholder}
                aria-label={labels.searchCoords}
                value={coordinateInput}
                onChange={(event) => setCoordinateInput(event.target.value)}
              />
              <button className="grid h-[30px] w-9 place-items-center rounded-full bg-primary text-white" aria-label={labels.search}>
                <SendHorizontal size={16} />
              </button>
            </form>
          )}
        </Dropdown>
        <button className={mapButton} aria-label={labels.fitTerritory} onClick={() => boundsRing && map.fitBounds(bboxOf(boundsRing), { padding: 60 })}>
          <ScanSearch size={20} />
        </button>
        <button className={mapButton} aria-label={labels.share} onClick={() => copyLink(labels.linkCopied)}>
          <Share2 size={20} />
        </button>
        <button className={mapButton} aria-label={labels.fullscreen} onClick={toggleFullscreen}>
          <Maximize size={20} />
        </button>
      </div>

      {showCenterMarker && (
        <div className="pointer-events-none absolute top-1/2 left-1/2 z-5 -translate-1/2 text-fg">
          <Plus size={18} />
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-4 bottom-6 z-10 flex items-end justify-between gap-2 *:pointer-events-auto">
        <TimeBar state={state} />
        <div className="flex h-10 items-center gap-1 rounded-lg bg-bg pr-2 mobile:hidden">
          <button className="icon-btn" aria-label={labels.centerMarker} aria-pressed={showCenterMarker} onClick={() => setShowCenterMarker((show) => !show)}>
            <Crosshair size={20} />
          </button>
          <CoordinateInput label={labels.lat} ariaLabel="Latitude" value={center.lat} onEnter={(lat) => flyTo(lat, center.lng)} />
          <CoordinateInput label={labels.lng} ariaLabel="Longitude" value={center.lng} onEnter={(lng) => flyTo(center.lat, lng)} />
        </div>
      </div>
    </>
  );
}

/** Shows the map center; typing a value and pressing Enter flies there. */
function CoordinateInput({ label, ariaLabel, value, onEnter }: { label: string; ariaLabel: string; value: number; onEnter: (value: number) => void }) {
  const rounded = value.toFixed(2);
  return (
    <label className="flex flex-col text-xs leading-[1.1] font-bold text-fg-2">
      {label}
      <input
        className="w-[70px] bg-transparent text-xs text-muted outline-0"
        aria-label={ariaLabel}
        key={rounded} // reset the field when the map moves
        defaultValue={rounded}
        onKeyDown={(event) => event.key === 'Enter' && onEnter(Number(event.currentTarget.value))}
      />
    </label>
  );
}
