import { useMemo } from 'react';
import { QueryClient, useQueries, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { codesInside } from './inside';
import { ADMIN_TYPES } from './state';

export const API = 'https://fogo-id.geodatin.com/api';

export type Names = { namePt: string; nameId: string; nameEn: string };
export type Territory = { type: string; code: number; name: string; parentLabel: string | null };
export type Period = { year: number; monthStart: number; monthEnd: number; landCover?: number };
export type RankRow = { code: number; name: string; value: number; position: number; parentLabel: string | null };
export type Area = {
  areaHa: number | null;
  previousMonthVariation?: { areaHa: number; percentage: number; year: number; month: number };
  previousYearVariation?: { areaHa: number; percentage: number; year: number };
  averageVariation?: { areaHa: number; percentage: number };
};
export type Series = { monthly: { year: number; month: number; areaHa: number }[]; annual: { year: number; areaHa: number }[] };

export async function get<T>(path: string, q: Record<string, unknown> = {}): Promise<T> {
  const qs = new URLSearchParams(
    Object.entries(q).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]),
  ).toString();
  const r = await fetch(`${API}${path}${qs ? `?${qs}` : ''}`);
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}

const STATIC = { staleTime: Infinity };
// Earth Engine tile URLs expire after a few hours
const TILES = { staleTime: 30 * 60_000, gcTime: 30 * 60_000 };
const STATS = { staleTime: 10 * 60_000, placeholderData: keepPreviousData };

const ready = (p?: Partial<Period>) => !!(p?.year && p.monthStart && p.monthEnd);

export const useYears = () => useQuery({ queryKey: ['years'], queryFn: () => get<number[]>('/statistics/years'), ...STATIC });
export const useMonths = (year?: number) =>
  useQuery({ queryKey: ['months', year], queryFn: () => get<number[]>(`/statistics/${year}/months`), enabled: !!year, ...STATIC });

// The API calls the level above provinces "region / Wilayah"; they are island groups, so name them that way.
const ISLAND = { pt: 'Ilha', id: 'Pulau', en: 'Island' };
export const useTypeNames = () =>
  useQuery({
    queryKey: ['typeNames'],
    queryFn: async () =>
      (await get<(Names & { type: string })[]>('/territories/translations')).map((x) =>
        x.type === 'region' ? { ...x, namePt: ISLAND.pt, nameId: ISLAND.id, nameEn: ISLAND.en } : x,
      ),
    ...STATIC,
  });
export const useLandCoverClasses = () =>
  useQuery({ queryKey: ['lcClasses'], queryFn: () => get<(Names & { id: number; color: string })[]>('/land-covers/translations'), ...STATIC });

export const useGroupings = (type: string, code: number) =>
  useQuery({
    queryKey: ['groupings', type, code],
    queryFn: async () => {
      const g = await get<Record<string, { pt: string; id: string; en: string }>>(`/territories/${type}/${code}/groupings`);
      return g.region ? { ...g, region: ISLAND } : g;
    },
    ...STATIC,
  });
export const useTerritoryLandCovers = (type: string, code: number) =>
  useQuery({
    queryKey: ['tlc', type, code],
    queryFn: () => get<(Names & { id: number })[]>(`/territories/${type}/${code}/land-covers`),
    ...STATIC,
  });
export const useBounds = (type: string, code: number) =>
  useQuery({
    queryKey: ['bounds', type, code],
    queryFn: () => get<{ geometry: { coordinates: number[][][] } }>(`/territories/${type}/${code}/bounds`),
    ...STATIC,
  });

export const searchTerritories = (term: string) => get<Territory[]>(`/territories/search/${encodeURIComponent(term)}`);
export const useSearch = (raw: string) => {
  // API is case-insensitive but matches the literal substring, so "TN  way" (double space) finds nothing
  const term = raw.trim().replace(/\s+/g, ' ');
  return useQuery({ queryKey: ['search', term], queryFn: () => searchTerritories(term), enabled: term.length > 1, ...STATIC, placeholderData: keepPreviousData });
};

/** Resolve a {type, code} to its name via search-by-code (codes are only unique per type). */
export const useTerritory = (type?: string, code?: number) =>
  useQuery({
    queryKey: ['territory', type, code],
    queryFn: async () => (await searchTerritories(String(code))).find((t) => t.type === type) ?? null,
    enabled: !!type && code != null,
    ...STATIC,
  });

type Sel = { type: string; code: number; grouping: string };
const path = (s: Sel) => `${s.type}/${s.code}/${s.grouping}`;
const national = (grouping: string): Sel => ({ type: 'country', code: 1, grouping });

// A derived layer has no numbers for territory × layer, but every listed feature lies wholly inside, so the
// territory's figures are the sum of those features' rows in national rankings (one request per month / year / class,
// however many features; per-feature requests queued hundreds deep on the API's 6 HTTP/1.1 connections and starved the map tiles).
const rankSum = (qc: QueryClient, g: string, p: Partial<Period>, codes: number[]) => {
  const s = national(g);
  return qc.fetchQuery({ queryKey: ['rank', s, p], queryFn: () => rankingRaw(s, p), ...STATS }).then((rows) => {
    const want = new Set(codes);
    return rows.reduce((t, r) => t + (want.has(r.code) ? (r.value ?? 0) : 0), 0);
  });
};
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export const useArea = (s: Sel, p: Partial<Period>, codes?: number[]) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['area', s, p, codes],
    queryFn: async (): Promise<Area> => (codes ? { areaHa: await rankSum(qc, s.grouping, p, codes) } : get<Area>(`/statistics/area/${path(s)}`, p)),
    enabled: ready(p),
    ...STATS,
  });
};
/** Thematic groupings with burned area here in this period, probed one by one. */
export const useThematicWithData = (type: string, code: number, p: Partial<Period>, candidates: string[]) =>
  useQuery({
    queryKey: ['thematicData', type, code, p, candidates],
    queryFn: async () => {
      const has = await Promise.all(
        candidates.map((g) => get<Area>(`/statistics/area/${type}/${code}/${g}`, p).then((r) => r.areaHa != null, () => false)),
      );
      return candidates.filter((_, i) => has[i]);
    },
    enabled: ready(p) && candidates.length > 0,
    ...STATS,
  });
type LcRow = Names & { id: number; areaHa: number; color?: string };
export const useLandCoverStats = (s: Sel, p: Partial<Period>, level: number, codes?: number[]) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['lcStats', s, p, level, codes],
    queryFn: async () => {
      const q = { ...p, landCover: undefined };
      if (!codes) return get<LcRow[]>(`/statistics/land-cover/${path(s)}`, { ...q, level });
      // rankings only filter by leaf class; translations list each parent followed by its leaves
      const [classes, leaves] = await Promise.all([
        qc.fetchQuery({ queryKey: ['lcClasses'], queryFn: () => get<LcRow[]>('/land-covers/translations'), ...STATIC }),
        qc.fetchQuery({ queryKey: ['tlc', 'country', 1], queryFn: () => get<LcRow[]>('/territories/country/1/land-covers'), ...STATIC }),
      ]);
      const leaf = new Set(leaves.map((l) => l.id));
      const parent = new Map<number, LcRow>();
      let top: LcRow | undefined;
      for (const c of classes) leaf.has(c.id) ? parent.set(c.id, top ?? c) : (top = c);
      const sums = await Promise.all([...leaf].map((id) => rankSum(qc, s.grouping, { ...q, landCover: id }, codes)));
      const out = new Map<number, LcRow>();
      [...leaf].forEach((id, i) => {
        const c = level === 1 ? parent.get(id) : classes.find((x) => x.id === id);
        if (!c || !sums[i]) return;
        const r = out.get(c.id) ?? { ...c, areaHa: 0 };
        r.areaHa += sums[i];
        out.set(c.id, r);
      });
      return [...out.values()].sort((a, b) => b.areaHa - a.areaHa);
    },
    enabled: ready(p),
    ...STATS,
  });
};
export const useTimeSeries = (s: Sel, p: Partial<Period>, codes?: number[]) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['series', s, p.monthStart, p.monthEnd, p.landCover, codes],
    queryFn: async (): Promise<Series> => {
      const q = { monthStart: p.monthStart, monthEnd: p.monthEnd, landCover: p.landCover };
      if (!codes) return get<Series>(`/statistics/time-series/${path(s)}`, q);
      const years = await qc.fetchQuery({ queryKey: ['years'], queryFn: () => get<number[]>('/statistics/years'), ...STATIC });
      const months = range(p.monthStart!, p.monthEnd!);
      const [monthly, annual] = await Promise.all([
        Promise.all(years.flatMap((year) => months.map(async (month) => ({ year, month, areaHa: await rankSum(qc, s.grouping, { ...q, year, monthStart: month, monthEnd: month }, codes) })))),
        Promise.all(years.map(async (year) => ({ year, areaHa: await rankSum(qc, s.grouping, { ...q, year }, codes) }))),
      ]);
      return { monthly: monthly.filter((m) => m.areaHa > 0), annual: annual.filter((a) => a.areaHa > 0) };
    },
    enabled: ready(p),
    ...STATS,
  });
};
const rankingRaw = (s: Sel, p: Partial<Period>) => get<RankRow[]>(`/statistics/ranking/${path(s)}/raw`, p);
export const useRanking = (s: Sel, p: Partial<Period>) =>
  useQuery({
    queryKey: ['rank', s, p],
    queryFn: () => rankingRaw(s, p),
    enabled: ready(p),
    // grouped by its own type (e.g. a village) the API ignores the territory and returns every one nationwide (83k villages)
    select: s.grouping === s.type ? (rows: RankRow[]) => rows.filter((r) => r.code === s.code) : undefined,
    ...STATS,
  });

type MapQ = Partial<Period> & { territoryType: string; territoryCode: number };
export const useFireTiles = (kind: 'raster' | 'heatmap', q: MapQ) =>
  useQuery({
    queryKey: ['fireTiles', kind, q],
    queryFn: () => get<{ url: string }>(kind === 'raster' ? '/maps/fire/monthly' : '/maps/fire/heatmap/monthly', q),
    enabled: ready(q),
    ...TILES,
  });

export const fetchGif = (q: Period & { coordinates: number[][]; theme: 'light' | 'dark' }) =>
  get<{ url: string }>('/maps/fire/monthly/gif', { ...q, coordinates: JSON.stringify(q.coordinates) });

export const groupingTilesUrl = (grouping: string) => `${API}/territories/grouping/tiles/${grouping}/{z}/{x}/{y}.mvt`;
export const shapeTilesUrl = (type: string, code: number, grouping: string) =>
  `${API}/territories/shape/tiles/${type}/${code}/${grouping}/{z}/{x}/{y}.mvt`;

/** Features of `grouping` inside the territory, from its tiles (see inside.ts). */
const useInside = (type: string, code: number, grouping: string, enabled: boolean) => {
  const box = useBounds(type, code).data?.geometry.coordinates[0];
  return useQuery({
    queryKey: ['inside', type, code, grouping],
    queryFn: () => codesInside(type, code, grouping, box!),
    enabled: enabled && !!box,
    ...STATIC,
  });
};

// Layers whose features carry regionCode/provinceCode: the API's own numbers are complete, so an empty answer means none here.
const CODED = new Set(['orangutanHabitat', 'tigerHabitat', 'forestMoratorium']);

/**
 * Thematic layers with burned area in a territory. `backed`: the API has statistics for it here. `derived`: the API only
 * has it nationally (features carry no admin codes), so it is listed when a burned feature lies inside the territory.
 */
export function useGroupingOptions(type: string, code: number, p: Partial<Period>) {
  const here = useGroupings(type, code);
  const names = useGroupings('country', 1).data ?? {};
  const thematic = Object.keys(names).filter((g) => !ADMIN_TYPES.has(g));
  // the groupings endpoint is unreliable below country (none for regions, tiger habitat for all of Kalimantan), so ask the stats
  // a thematic territory (e.g. a national park) only accepts itself as grouping, so every other layer is checked by geometry
  const admin = ADMIN_TYPES.has(type);
  const probe = useThematicWithData(type, code, p, type === 'country' || !admin ? [] : thematic);
  const backed = type === 'country' ? thematic : (probe.data ?? []);
  const settled = here.isSuccess && (type === 'country' || !admin || probe.isSuccess);
  // coded features only carry region/province codes, so below province they need the inside-check too
  const coded = type === 'region' || type === 'province' ? CODED : new Set<string>();
  const box = useBounds(type, code).data?.geometry.coordinates[0];
  const candidates = settled && type !== 'country' ? thematic.filter((g) => g !== type && !backed.includes(g) && !coded.has(g)) : [];
  const checks = useQueries({
    queries: thematic.flatMap((g) => {
      const on = candidates.includes(g);
      return [
        { queryKey: ['inside', type, code, g], queryFn: () => codesInside(type, code, g, box!), enabled: on && !!box, ...STATIC },
        { queryKey: ['rank', national(g), p], queryFn: () => rankingRaw(national(g), p), enabled: on && ready(p), ...STATS },
      ];
    }),
  });
  // burned features of each candidate that touch the territory / lie wholly in it
  const burned = (i: number, key: 'inside' | 'whole' | 'partial') => {
    const found = (checks[2 * i].data as Awaited<ReturnType<typeof codesInside>> | undefined)?.[key];
    return !!found && !!(checks[2 * i + 1].data as RankRow[] | undefined)?.some((r) => r.value > 0 && found.has(r.code));
  };
  // listed only when every burned feature touching the territory lies wholly in it: any that also reaches outside would
  // carry burned area that isn't this territory's, so the whole layer is left out
  const derived = thematic.filter((g, i) => candidates.includes(g) && burned(i, 'whole') && !burned(i, 'partial'));
  // uncoded: layers whose numbers come from the inside-check (the map clips them, the ranking is narrowed)
  return { names, backed, derived, uncoded: candidates, checking: candidates.length > 0 && checks.some((c) => c.isLoading) };
}

/** Ranking for the selection; for a derived layer, the national ranking narrowed to the features wholly inside. */
export function useRankingFor(s: Sel, p: Partial<Period>, derived: boolean) {
  const inside = useInside(s.type, s.code, s.grouping, derived);
  const r = useRanking(derived ? national(s.grouping) : s, p);
  const data = useMemo(() => {
    if (!derived) return r.data;
    const whole = inside.data?.whole;
    return whole && r.data?.filter((x) => x.value > 0 && whole.has(x.code));
  }, [r.data, inside.data, derived]);
  return { ...r, data, isLoading: r.isLoading || (derived && inside.isLoading) };
}
export const useInsideCodes = (type: string, code: number, grouping: string, enabled: boolean) => useInside(type, code, grouping, enabled).data?.whole;


/** A village's district code. Village codes aren't nested BPS codes, but its grouping-tile feature carries districtCode. */
export const useVillageDistrict = (code: number, enabled: boolean) => {
  const box = useBounds('village', code).data?.geometry.coordinates[0];
  return useQuery({
    queryKey: ['villageDistrict', code],
    enabled: enabled && !!box,
    ...STATIC,
    queryFn: async () => {
      // z10 tiles touching the village's bbox corners (usually 1, at most 4)
      const z = 10;
      const n = 2 ** z;
      const tx = (lon: number) => Math.floor(((lon + 180) / 360) * n);
      const ty = (lat: number) => {
        const r = (lat * Math.PI) / 180;
        return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
      };
      const tiles = new Set(box!.map(([lon, lat]) => `${tx(lon)}/${ty(lat)}`));
      for (const t of tiles) {
        const r = await fetch(groupingTilesUrl('village').replace('{z}/{x}/{y}', `${z}/${t}`));
        if (!r.ok) continue;
        const layer = new VectorTile(new PbfReader(new Uint8Array(await r.arrayBuffer()))).layers.default;
        for (let i = 0; i < (layer?.length ?? 0); i++) {
          const f = layer.feature(i).properties;
          if (Number(f.code) === code && f.districtCode != null) return Number(f.districtCode);
        }
      }
      return null;
    },
  });
};
