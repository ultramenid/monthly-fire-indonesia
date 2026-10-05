import { useQuery } from '@tanstack/react-query';
import { STATISTICS, TILE_URLS, get, isPeriodReady, selectionPath, type Names, type Period, type Selection } from './client';

export type RankRow = { code: number; name: string; value: number; position: number; parentLabel: string | null };
export type Area = { areaHa: number | null };
type Series = { monthly: { year: number; month: number; areaHa: number }[]; annual: { year: number; areaHa: number }[] };
type LandCoverRow = Names & { id: number; areaHa: number; color?: string };

export const fetchRanking = (selection: Selection, period: Partial<Period>) =>
  get<RankRow[]>(`/statistics/ranking/${selectionPath(selection)}/raw`, period);

export const useArea = (selection: Selection, period: Partial<Period>) =>
  useQuery({
    queryKey: ['area', selection, period],
    queryFn: () => get<Area>(`/statistics/area/${selectionPath(selection)}`, period),
    enabled: isPeriodReady(period),
    ...STATISTICS,
  });

export const useLandCoverStats = (selection: Selection, period: Partial<Period>, level: number) =>
  useQuery({
    queryKey: ['lcStats', selection, period, level],
    queryFn: () => get<LandCoverRow[]>(`/statistics/land-cover/${selectionPath(selection)}`, { ...period, landCover: undefined, level }),
    enabled: isPeriodReady(period),
    ...STATISTICS,
  });

export const useTimeSeries = (selection: Selection, period: Partial<Period>) =>
  useQuery({
    queryKey: ['series', selection, period.monthStart, period.monthEnd, period.landCover],
    queryFn: () =>
      get<Series>(`/statistics/time-series/${selectionPath(selection)}`, { monthStart: period.monthStart, monthEnd: period.monthEnd, landCover: period.landCover }),
    enabled: isPeriodReady(period),
    ...STATISTICS,
  });

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
