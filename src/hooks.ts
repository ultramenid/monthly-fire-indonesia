import { useEffect, useMemo, useRef } from 'react';
import { usePrefs, type Theme } from './state';

export function useTheme(): [Theme, (theme: Theme) => void] {
  const { theme, setTheme } = usePrefs();
  return [theme, setTheme];
}

/** Raw color values of the current theme, for charts and the map (they can't read CSS classes). */
export function useTokens() {
  const [theme] = useTheme();
  return useMemo(() => {
    const styles = getComputedStyle(document.documentElement);
    const read = (name: string) => styles.getPropertyValue(`--${name}`).trim();
    return { theme, text: read('text'), text2: read('text-2'), muted: read('muted'), border: read('border'), chart: read('chart'), bg: read('bg') };
  }, [theme]);
}

/** Calls `close` on a click outside the returned ref's element, or on Escape. */
export function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);
  return ref;
}
