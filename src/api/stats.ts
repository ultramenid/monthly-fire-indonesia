import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { NEVER_STALE, STATISTICS, TILE_URLS, get, isPeriodReady, nationalSelection, selectionPath, type Names, type Period, type Selection } from './client';

export type RankRow = { code: number; name: string; value: number; position: number; parentLabel: string | null };
export type Area = { areaHa: number | null };
type Series = { monthly: { year: number; month: number; areaHa: number }[]; annual: { year: number; areaHa: number }[] };
type LandCoverRow = Names & { id: number; areaHa: number; color?: string };

export const fetchRanking = (selection: Selection, period: Partial<Period>) =>
  get<RankRow[]>(`/statistics/ranking/${selectionPath(selection)}/raw`, period);

// `featureCodes` is set for a "derived" layer (see thematic.ts): the API has no numbers for territory × layer, but we know
// which of the layer's features lie inside the territory. So we add up those features' rows from the national ranking.
// That is one request per period, however many features there are.
function sumFeatures(queryClient: QueryClient, grouping: string, period: Partial<Period>, featureCodes: number[]) {
  const selection = nationalSelection(grouping);
  const wanted = new Set(featureCodes);
  return queryClient
    .fetchQuery({ queryKey: ['rank', selection, period], queryFn: () => fetchRanking(selection, period), ...STATISTICS })
    .then((rows) => rows.reduce((total, row) => total + (wanted.has(row.code) ? (row.value ?? 0) : 0), 0));
}

const numbersBetween = (first: number, last: number) => Array.from({ length: last - first + 1 }, (_, index) => first + index);

export const useArea = (selection: Selection, period: Partial<Period>, featureCodes?: number[]) => {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['area', selection, period, featureCodes],
    queryFn: async (): Promise<Area> => {
      if (featureCodes) return { areaHa: await sumFeatures(queryClient, selection.grouping, period, featureCodes) };
      return get<Area>(`/statistics/area/${selectionPath(selection)}`, period);
    },
    enabled: isPeriodReady(period),
    ...STATISTICS,
  });
};

export const useLandCoverStats = (selection: Selection, period: Partial<Period>, level: number, featureCodes?: number[]) => {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['lcStats', selection, period, level, featureCodes],
    queryFn: async () => {
      const periodAllClasses = { ...period, landCover: undefined };
      if (!featureCodes) return get<LandCoverRow[]>(`/statistics/land-cover/${selectionPath(selection)}`, { ...periodAllClasses, level });

      // Rankings can only filter by the most detailed classes ("leaves"). The class list has each parent class
      // followed by its leaves, so we can tell which parent a leaf belongs to.
      const [allClasses, leafClasses] = await Promise.all([
        queryClient.fetchQuery({ queryKey: ['lcClasses'], queryFn: () => get<LandCoverRow[]>('/land-covers/translations'), ...NEVER_STALE }),
        queryClient.fetchQuery({ queryKey: ['tlc', 'country', 1], queryFn: () => get<LandCoverRow[]>('/territories/country/1/land-covers'), ...NEVER_STALE }),
      ]);
      const leafIds = [...new Set(leafClasses.map((leaf) => leaf.id))];
      const parentOfLeaf = new Map<number, LandCoverRow>();
      let currentParent: LandCoverRow | undefined;
      for (const landCoverClass of allClasses) {
        if (leafIds.includes(landCoverClass.id)) parentOfLeaf.set(landCoverClass.id, currentParent ?? landCoverClass);
        else currentParent = landCoverClass;
      }

      const leafSums = await Promise.all(leafIds.map((id) => sumFeatures(queryClient, selection.grouping, { ...periodAllClasses, landCover: id }, featureCodes)));
      const rowsByClass = new Map<number, LandCoverRow>();
      leafIds.forEach((leafId, index) => {
        const landCoverClass = level === 1 ? parentOfLeaf.get(leafId) : allClasses.find((item) => item.id === leafId);
        if (!landCoverClass || !leafSums[index]) return;
        const row = rowsByClass.get(landCoverClass.id) ?? { ...landCoverClass, areaHa: 0 };
        row.areaHa += leafSums[index];
        rowsByClass.set(landCoverClass.id, row);
      });
      return [...rowsByClass.values()].sort((first, second) => second.areaHa - first.areaHa);
    },
    enabled: isPeriodReady(period),
    ...STATISTICS,
  });
};

export const useTimeSeries = (selection: Selection, period: Partial<Period>, featureCodes?: number[]) => {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['series', selection, period.monthStart, period.monthEnd, period.landCover, featureCodes],
    queryFn: async (): Promise<Series> => {
      const params = { monthStart: period.monthStart, monthEnd: period.monthEnd, landCover: period.landCover };
      if (!featureCodes) return get<Series>(`/statistics/time-series/${selectionPath(selection)}`, params);

      const years = await queryClient.fetchQuery({ queryKey: ['years'], queryFn: () => get<number[]>('/statistics/years'), ...NEVER_STALE });
      const months = numbersBetween(period.monthStart!, period.monthEnd!);
      const sum = (extra: Partial<Period>) => sumFeatures(queryClient, selection.grouping, { ...params, ...extra }, featureCodes);
      const [monthly, annual] = await Promise.all([
        Promise.all(years.flatMap((year) => months.map(async (month) => ({ year, month, areaHa: await sum({ year, monthStart: month, monthEnd: month }) })))),
        Promise.all(years.map(async (year) => ({ year, areaHa: await sum({ year }) }))),
      ]);
      return { monthly: monthly.filter((entry) => entry.areaHa > 0), annual: annual.filter((entry) => entry.areaHa > 0) };
    },
    enabled: isPeriodReady(period),
    ...STATISTICS,
  });
};

export const useRanking = (selection: Selection, period: Partial<Period>) =>
  useQuery({
    queryKey: ['rank', selection, period],
    queryFn: () => fetchRanking(selection, period),
    enabled: isPeriodReady(period),
    // Grouped by its own type (e.g. a village by villages), the API returns every village in the country.
    select: selection.grouping === selection.type ? (rows: RankRow[]) => rows.filter((row) => row.code === selection.code) : undefined,
    ...STATISTICS,
  });

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
