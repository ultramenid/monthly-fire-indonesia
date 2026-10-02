import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import * as echarts from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { usePref } from './state';

echarts.use([BarChart, PieChart, GridComponent, TooltipComponent, SVGRenderer]);

export type Theme = 'dark' | 'light';
/** Theme pref; the `data-theme` attribute is kept in sync so CSS tokens switch before any render reads them. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, set] = usePref<Theme>('theme', 'dark');
  return [theme, (t) => ((document.documentElement.dataset.theme = t), set(t))];
}

/** Current CSS token values, re-read when the theme flips (charts and map need raw colors). */
export function useTokens() {
  const [theme] = useTheme();
  const read = () => {
    const s = getComputedStyle(document.documentElement);
    const v = (k: string) => s.getPropertyValue(`--${k}`).trim();
    return { theme, text: v('text'), text2: v('text-2'), muted: v('muted'), border: v('border'), chart: v('chart'), bg: v('bg'), surface: v('surface'), primary: v('primary') };
  };
  return useMemo(read, [theme]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Closes on outside click / Escape. */
export function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

export function Modal({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <span>{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

let pushToast: (m: string) => void = () => {};
export const toast = (m: string) => pushToast(m);
export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let timer: number;
    pushToast = (m) => {
      setMsg(m);
      clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 2200);
    };
  }, []);
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
}

export function EChart({ option, height = 280 }: { option: echarts.EChartsCoreOption; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts>(null);
  useEffect(() => {
    const c = echarts.init(el.current!, null, { renderer: 'svg' });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      c.dispose();
    };
  }, []);
  useEffect(() => {
    chart.current?.setOption(option, true);
  }, [option]);
  return <div ref={el} style={{ height, width: '100%' }} />;
}

export const Skeleton = ({ h }: { h: number }) => <div className="skeleton" style={{ height: h }} />;

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function copyLink(msg: string) {
  try {
    await navigator.clipboard.writeText(location.href);
    toast(msg);
  } catch {
    toast(location.href);
  }
}
