import { useSyncExternalStore } from 'react';

/** All shareable view state lives in the URL query string, so links, refresh and browser back/forward just work. */
export type AppState = {
  type: string;
  code: number;
  grouping: string;
  year?: number;
  monthStart?: number;
  monthEnd?: number;
  landCover?: number;
  basemap: 'default' | 'satellite';
  opacity: number;
  paint: boolean;
};

/** Drill-down: selecting an admin territory groups it by the next level down (country → regions → provinces → …). */
const NEXT: Record<string, string> = { country: 'region', region: 'province', province: 'regency', regency: 'district', district: 'village' };
export const ADMIN_TYPES = new Set(['country', 'region', 'province', 'regency', 'district', 'village']);
export const defaultGrouping = (type: string) => NEXT[type] ?? type;

const num = (v: string | null) => (v == null || v === '' ? undefined : Number(v));

function read(): AppState {
  const q = new URLSearchParams(location.search);
  return {
    type: q.get('t') ?? 'country',
    code: num(q.get('c')) ?? 1,
    grouping: q.get('g') ?? defaultGrouping(q.get('t') ?? 'country'),
    year: num(q.get('y')),
    monthStart: num(q.get('ms')),
    monthEnd: num(q.get('me')),
    landCover: num(q.get('lc')),
    basemap: q.get('bm') === 'satellite' ? 'satellite' : 'default',
    opacity: num(q.get('op')) ?? 100,
    paint: q.get('paint') === '1',
  };
}

function write(s: AppState) {
  const q = new URLSearchParams();
  const set = (k: string, v: unknown, def?: unknown) => v != null && v !== def && q.set(k, String(v));
  set('t', s.type, 'country');
  set('c', s.code, 1);
  set('g', s.grouping, defaultGrouping(s.type));
  set('y', s.year);
  set('ms', s.monthStart);
  set('me', s.monthEnd);
  set('lc', s.landCover);
  set('bm', s.basemap, 'default');
  set('op', s.opacity, 100);
  set('paint', s.paint ? 1 : undefined);
  const qs = q.toString();
  return `${location.pathname}${qs ? `?${qs}` : ''}`;
}

let state = read();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
addEventListener('popstate', () => {
  state = read();
  emit();
});

/** `push` adds a history entry (territory navigation); everything else replaces. */
export function setState(patch: Partial<AppState>, push = false) {
  state = { ...state, ...patch };
  history[push ? 'pushState' : 'replaceState'](null, '', write(state));
  emit();
}

export const selectTerritory = (type: string, code: number, grouping = defaultGrouping(type)) =>
  setState({ type, code, grouping, landCover: undefined }, true);

export const useAppState = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );

/** Tiny persisted preference (theme, language). */
export function usePref<T extends string>(key: string, def: T): [T, (v: T) => void] {
  const v = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => {
      try {
        return (localStorage.getItem(key) as T) ?? def;
      } catch {
        return def;
      }
    },
  );
  return [
    v,
    (nv: T) => {
      try {
        localStorage.setItem(key, nv);
      } catch {
        /* storage unavailable */
      }
      emit();
    },
  ];
}

