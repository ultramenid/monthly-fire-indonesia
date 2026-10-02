import { create } from 'zustand';

// All shareable view state lives in the URL query string, so links, refresh and back/forward just work.
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

// Drill-down order: selecting a territory groups it by the next admin level.
const NEXT_LEVEL: Record<string, string> = { country: 'region', region: 'province', province: 'regency', regency: 'district', district: 'village' };
export const ADMIN_TYPES = new Set(['country', 'region', 'province', 'regency', 'district', 'village']);
export const defaultGrouping = (type: string) => NEXT_LEVEL[type] ?? type;

const toNumber = (value: string | null) => (value == null || value === '' ? undefined : Number(value));

function readUrl(): AppState {
  const params = new URLSearchParams(location.search);
  const type = params.get('t') ?? 'country';
  return {
    type,
    code: toNumber(params.get('c')) ?? 1,
    grouping: params.get('g') ?? defaultGrouping(type),
    year: toNumber(params.get('y')),
    monthStart: toNumber(params.get('ms')),
    monthEnd: toNumber(params.get('me')),
    landCover: toNumber(params.get('lc')),
    basemap: params.get('bm') === 'satellite' ? 'satellite' : 'default',
    opacity: toNumber(params.get('op')) ?? 100,
    paint: params.get('paint') === '1',
  };
}

function toUrl(state: AppState) {
  const params = new URLSearchParams();
  const put = (key: string, value: unknown, defaultValue?: unknown) => {
    if (value != null && value !== defaultValue) params.set(key, String(value));
  };
  put('t', state.type, 'country');
  put('c', state.code, 1);
  put('g', state.grouping, defaultGrouping(state.type));
  put('y', state.year);
  put('ms', state.monthStart);
  put('me', state.monthEnd);
  put('lc', state.landCover);
  put('bm', state.basemap, 'default');
  put('op', state.opacity, 100);
  put('paint', state.paint ? 1 : undefined);
  const query = params.toString();
  return `${location.pathname}${query ? `?${query}` : ''}`;
}

const useAppStore = create<AppState>(readUrl);
addEventListener('popstate', () => useAppStore.setState(readUrl()));

export const useAppState = () => useAppStore();

/** Update the view. `addToHistory` creates a back-button entry (used when opening a territory). */
export function setState(changes: Partial<AppState>, addToHistory = false) {
  useAppStore.setState(changes);
  history[addToHistory ? 'pushState' : 'replaceState'](null, '', toUrl(useAppStore.getState()));
}

export const selectTerritory = (type: string, code: number, grouping = defaultGrouping(type)) =>
  setState({ type, code, grouping, landCover: undefined }, true);

// Preferences that stay in this browser (not in the URL).
export type Theme = 'dark' | 'light';
export type Lang = 'en' | 'id' | 'pt';

function readStorage<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked (private mode): the choice just isn't remembered
  }
}

type Prefs = { theme: Theme; lang: Lang; setTheme: (theme: Theme) => void; setLang: (lang: Lang) => void };

export const usePrefs = create<Prefs>((set) => ({
  theme: readStorage<Theme>('theme', 'dark'),
  lang: readStorage<Lang>('lang', 'en'),
  setTheme: (theme) => {
    document.documentElement.dataset.theme = theme;
    writeStorage('theme', theme);
    set({ theme });
  },
  setLang: (lang) => {
    writeStorage('lang', lang);
    set({ lang });
  },
}));
