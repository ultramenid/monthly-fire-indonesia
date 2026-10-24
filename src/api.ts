import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { config } from './config';
import { tileX, tileY } from './lib/geo';
import { ADMIN_TYPES } from './state';

export const API = config.VITE_API_URL;

export type Names = { namePt: string; nameId: string; nameEn: string };
export type Period = { year: number; monthStart: number; monthEnd: number; landCover?: number };
/** A territory plus the layer its sub-territories are grouped by. */
export type Selection = { type: string; code: number; grouping: string };
export type Territory = { type: string; code: number; name: string; parentLabel: string | null };
export type RankRow = { code: number; name: string; value: number; position: number; parentLabel: string | null };
export type Area = { areaHa: number | null };
type LocalizedName = { pt: string; id: string; en: string };
type Series = { monthly: { year: number; month: number; areaHa: number }[]; annual: { year: number; areaHa: number }[] };
type LandCoverRow = Names & { id: number; areaHa: number; color?: string };

/** GET from the API. Empty params are left out. Failed responses throw an error carrying the HTTP status. */
async function get<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
  const query = new URLSearchParams(
    Object.entries(params)
      .filter(([, value]) => value != null && value !== '')
      .map(([key, value]) => [key, String(value)]),
  ).toString();
  const response = await fetch(`${API}${path}${query ? `?${query}` : ''}`);
  if (!response.ok) throw Object.assign(new Error(`${response.status} ${path}`), { status: response.status });
  return response.json();
}

// Cache settings for react-query
const NEVER_STALE = { staleTime: Infinity };
const TILE_URLS = { staleTime: 30 * 60_000, gcTime: 30 * 60_000 }; // Earth Engine tile URLs expire after a few hours
const STATISTICS = { staleTime: 10 * 60_000, placeholderData: keepPreviousData }; // keep the old chart while refetching

const isPeriodReady = (period?: Partial<Period>) => !!(period?.year && period.monthStart && period.monthEnd);

/** Only the period fields of a bigger object (e.g. the app state), so query keys don't change with unrelated fields. */
export const periodOf = (state: Partial<Period>): Partial<Period> => ({
  year: state.year,
  monthStart: state.monthStart,
  monthEnd: state.monthEnd,
  landCover: state.landCover,
});

export const groupingTilesUrl = (grouping: string) => `${API}/territories/grouping/tiles/${grouping}/{z}/{x}/{y}.mvt`;
export const shapeTilesUrl = (type: string, code: number, grouping: string) =>
  `${API}/territories/shape/tiles/${type}/${code}/${grouping}/{z}/{x}/{y}.mvt`;

// ---- Territories ----

// The API calls the level above provinces "region / Wilayah"; they are island groups, so we call them islands.
const ISLAND: LocalizedName = { pt: 'Ilha', id: 'Pulau', en: 'Island' };

export const useYears = () => useQuery({ queryKey: ['years'], queryFn: () => get<number[]>('/statistics/years'), ...NEVER_STALE });

export const useMonths = (year?: number) =>
  useQuery({ queryKey: ['months', year], queryFn: () => get<number[]>(`/statistics/${year}/months`), enabled: !!year, ...NEVER_STALE });

export const useTypeNames = () =>
  useQuery({
    queryKey: ['typeNames'],
    queryFn: async () => {
      const types = await get<(Names & { type: string })[]>('/territories/translations');
      return types.map((item) => (item.type === 'region' ? { ...item, namePt: ISLAND.pt, nameId: ISLAND.id, nameEn: ISLAND.en } : item));
    },
    ...NEVER_STALE,
  });

export const useLandCoverClasses = () =>
  useQuery({ queryKey: ['lcClasses'], queryFn: () => get<(Names & { id: number; color: string })[]>('/land-covers/translations'), ...NEVER_STALE });

export const useGroupings = (type: string, code: number) =>
  useQuery({
    queryKey: ['groupings', type, code],
    queryFn: async () => {
      const groupings = await get<Record<string, LocalizedName>>(`/territories/${type}/${code}/groupings`);
      return groupings.region ? { ...groupings, region: ISLAND } : groupings;
    },
    ...NEVER_STALE,
  });

export const useTerritoryLandCovers = (type: string, code: number) =>
  useQuery({
    queryKey: ['tlc', type, code],
    queryFn: () => get<(Names & { id: number })[]>(`/territories/${type}/${code}/land-covers`),
    ...NEVER_STALE,
  });

export const useBounds = (type: string, code: number, enabled = true) =>
  useQuery({
    queryKey: ['bounds', type, code],
    queryFn: () => get<{ geometry: { coordinates: number[][][] } }>(`/territories/${type}/${code}/bounds`),
    enabled,
    ...NEVER_STALE,
  });

const searchTerritories = (term: string) => get<Territory[]>(`/territories/search/${encodeURIComponent(term)}`);

export const useSearch = (input: string) => {
  // the API matches the exact text, so "TN  Way" (two spaces) would find nothing
  const term = input.trim().replace(/\s+/g, ' ');
  return useQuery({
    queryKey: ['search', term],
    queryFn: () => searchTerritories(term),
    enabled: term.length > 1,
    ...NEVER_STALE,
    placeholderData: keepPreviousData,
  });
};

/** Looks up a territory's name by searching its code (codes are only unique within a type). */
export const useTerritory = (type?: string, code?: number) =>
  useQuery({
    queryKey: ['territory', type, code],
    queryFn: async () => (await searchTerritories(String(code))).find((territory) => territory.type === type) ?? null,
    enabled: !!type && code != null,
    ...NEVER_STALE,
  });

/** A village's district code, read from the village map tiles (village codes don't contain it). */
export const useVillageDistrict = (code: number, enabled: boolean) => {
  const corners = useBounds('village', code, enabled).data?.geometry.coordinates[0];
  return useQuery({
    queryKey: ['villageDistrict', code],
    enabled: enabled && !!corners,
    ...NEVER_STALE,
    queryFn: async () => {
      const zoom = 10;
      const tiles = new Set(corners!.map(([lon, lat]) => `${tileX(lon, zoom)}/${tileY(lat, zoom)}`));
      for (const tile of tiles) {
        const response = await fetch(groupingTilesUrl('village').replace('{z}/{x}/{y}', `${zoom}/${tile}`));
        if (!response.ok) continue;
        const layer = new VectorTile(new PbfReader(new Uint8Array(await response.arrayBuffer()))).layers.default;
        for (let index = 0; index < (layer?.length ?? 0); index++) {
          const properties = layer.feature(index).properties;
          if (Number(properties.code) === code && properties.districtCode != null) return Number(properties.districtCode);
        }
      }
      return null;
    },
  });
};

// ---- Statistics ----

const selectionPath = ({ type, code, grouping }: Selection) => `${type}/${code}/${grouping}`;

const fetchStatistics = <T>(endpoint: string, selection: Selection, params: Record<string, unknown>) =>
  get<T>(`/statistics/${endpoint}/${selectionPath(selection)}`, params);

/** One statistics query: waits for a full period and keeps the old chart while refetching. */
const useStatistics = <T>(key: unknown[], queryFn: () => Promise<T>, period: Partial<Period>) =>
  useQuery({ queryKey: key, queryFn, enabled: isPeriodReady(period), ...STATISTICS });

export const useArea = (selection: Selection, period: Partial<Period>) =>
  useStatistics(['area', selection, period], () => fetchStatistics<Area>('area', selection, period), period);

export const useLandCoverStats = (selection: Selection, period: Partial<Period>, level: number) =>
  useStatistics(
    ['lcStats', selection, period, level],
    () => fetchStatistics<LandCoverRow[]>('land-cover', selection, { ...period, landCover: undefined, level }),
    period,
  );

export const useTimeSeries = (selection: Selection, period: Partial<Period>) => {
  const { monthStart, monthEnd, landCover } = period;
  return useStatistics(
    ['series', selection, monthStart, monthEnd, landCover],
    () => fetchStatistics<Series>('time-series', selection, { monthStart, monthEnd, landCover }),
    period,
  );
};

export const useRanking = (selection: Selection, period: Partial<Period>) =>
  useQuery({
    queryKey: ['rank', selection, period],
    queryFn: () => get<RankRow[]>(`/statistics/ranking/${selectionPath(selection)}/raw`, period),
    enabled: isPeriodReady(period),
    // Grouped by its own type (e.g. a village by villages), the API returns every village in the country.
    select: selection.grouping === selection.type ? (rows: RankRow[]) => rows.filter((row) => row.code === selection.code) : undefined,
    ...STATISTICS,
  });

/*
 * Thematic layers are things like national parks, concessions or peatland. A layer is only offered for a territory
 * when the API itself has burned-area statistics for that territory × layer. We never compute numbers ourselves.
 */

/** Which of `layers` the API has burned-area numbers for in this territory and period. */
const useLayersWithData = (type: string, code: number, period: Partial<Period>, layers: string[]) =>
  useQuery({
    queryKey: ['thematicData', type, code, period, layers],
    queryFn: async () => {
      const hasData = await Promise.all(
        layers.map((grouping) =>
          fetchStatistics<Area>('area', { type, code, grouping }, period).then(
            (area) => area.areaHa != null,
            () => false,
          ),
        ),
      );
      return layers.filter((_, index) => hasData[index]);
    },
    enabled: isPeriodReady(period) && layers.length > 0,
    ...STATISTICS,
    // no "keep previous data": the previous territory's layers would show up here
    placeholderData: undefined,
  });

/** Thematic layers that can be picked as grouping for this territory. */
export function useGroupingOptions(type: string, code: number, period: Partial<Period>) {
  const layerNames = useGroupings('country', 1);
  const names = layerNames.data ?? {};
  const allLayers = Object.keys(names).filter((grouping) => !ADMIN_TYPES.has(grouping));
  const isCountry = type === 'country';
  const isAdmin = ADMIN_TYPES.has(type);

  // The groupings endpoint is unreliable below country level, so ask the statistics endpoint per layer instead.
  // A thematic territory (e.g. a national park) only has numbers for itself, so it offers no other layers.
  const layersWithData = useLayersWithData(type, code, period, isAdmin && !isCountry ? allLayers : []);
  const backed = isCountry ? allLayers : isAdmin ? (layersWithData.data ?? []) : [];
  const isSettled = layerNames.isSuccess && (isCountry || !isAdmin || layersWithData.isSuccess);

  return { names, backed, isSettled };
}

// ---- Map ----

type TileQuery = Partial<Period> & { territoryType: string; territoryCode: number };

export const useFireTiles = (kind: 'raster' | 'heatmap', tileQuery: TileQuery) =>
  useQuery({
    queryKey: ['fireTiles', kind, tileQuery],
    queryFn: () => get<{ url: string }>(kind === 'raster' ? '/maps/fire/monthly' : '/maps/fire/heatmap/monthly', tileQuery),
    enabled: isPeriodReady(tileQuery),
    ...TILE_URLS,
  });

export const fetchGif = (params: Period & { coordinates: number[][]; theme: 'light' | 'dark' }) =>
  get<{ url: string }>('/maps/fire/monthly/gif', { ...params, coordinates: JSON.stringify(params.coordinates) });
