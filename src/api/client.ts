import { keepPreviousData } from '@tanstack/react-query';

export const API = import.meta.env.VITE_API_URL;

export type Names = { namePt: string; nameId: string; nameEn: string };
export type Period = { year: number; monthStart: number; monthEnd: number; landCover?: number };
/** A territory plus the layer its sub-territories are grouped by. */
export type Selection = { type: string; code: number; grouping: string };

/** GET from the API. Empty params are left out. Failed responses throw an error carrying the HTTP status. */
export async function get<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
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
export const NEVER_STALE = { staleTime: Infinity };
export const TILE_URLS = { staleTime: 30 * 60_000, gcTime: 30 * 60_000 }; // Earth Engine tile URLs expire after a few hours
export const STATISTICS = { staleTime: 10 * 60_000, placeholderData: keepPreviousData }; // keep the old chart while refetching

export const isPeriodReady = (period?: Partial<Period>) => !!(period?.year && period.monthStart && period.monthEnd);

export const selectionPath = (selection: Selection) => `${selection.type}/${selection.code}/${selection.grouping}`;
export const nationalSelection = (grouping: string): Selection => ({ type: 'country', code: 1, grouping });

export const groupingTilesUrl = (grouping: string) => `${API}/territories/grouping/tiles/${grouping}/{z}/{x}/{y}.mvt`;
export const shapeTilesUrl = (type: string, code: number, grouping: string) =>
  `${API}/territories/shape/tiles/${type}/${code}/${grouping}/{z}/{x}/{y}.mvt`;
