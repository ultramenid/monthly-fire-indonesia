import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import * as echarts from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { useI18n } from './i18n';
import { onToast } from './lib/browser';

echarts.use([BarChart, PieChart, GridComponent, TooltipComponent, SVGRenderer]);

/** Full-screen dimmed layer; clicking the dimmed area (not its content) calls onClose. */
export function Overlay({ onClose, className = 'place-items-center', children }: { onClose: () => void; className?: string; children: ReactNode }) {
  return (
    <div className={`fixed inset-0 z-50 grid bg-overlay ${className}`} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      {children}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return (
    <Overlay onClose={onClose}>
      <div className="max-h-[calc(100vh-32px)] w-[min(900px,calc(100vw-32px))] overflow-auto rounded-xl border bg-bg p-4" role="dialog" aria-modal="true">
        <div className="mb-3 flex items-center justify-between text-base font-bold">
          <span>{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </Overlay>
  );
}

export function Toaster() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let timer: number;
    onToast((next) => {
      setMessage(next);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 2200);
    });
  }, []);
  if (!message) return null;
  return (
    <div className="fixed bottom-6 left-1/2 z-70 -translate-x-1/2 rounded-lg bg-fg px-4 py-2.5 font-semibold text-bg" role="status">
      {message}
    </div>
  );
}

// "Unreachable" = the request itself failed (offline, blocked) or a gateway error.
// A 4xx/500 from one endpoint is that endpoint's problem, not a connection problem.
const isUnreachable = (error: unknown) => error instanceof TypeError || [502, 503, 504].includes((error as { status?: number } | null)?.status ?? 0);

/** Banner while the API can't be reached; failed requests are retried every 15s. */
export function ApiStatus() {
  const { labels } = useI18n();
  const queryClient = useQueryClient();
  const cache = queryClient.getQueryCache();
  const isDown = useSyncExternalStore(
    (onChange) => cache.subscribe(onChange),
    () => cache.findAll({ predicate: (query) => query.state.status === 'error' && isUnreachable(query.state.error) && query.getObserversCount() > 0 }).length > 0,
  );
  const retry = () => queryClient.refetchQueries({ type: 'active', predicate: (query) => query.state.status === 'error' });
  useEffect(() => {
    if (!isDown) return;
    const timer = setInterval(retry, 15_000);
    return () => clearInterval(timer);
  }, [isDown]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!isDown) return null;
  return (
    <div className="fixed top-[72px] left-1/2 z-70 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-lg border border-primary bg-surface px-4 py-2.5 text-[13px]" role="alert">
      {labels.offline}
      <button className="link-btn" onClick={retry}>
        {labels.retry}
      </button>
    </div>
  );
}

export function EChart({ option, height = 280 }: { option: echarts.EChartsCoreOption; height?: number }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts>(null);
  useEffect(() => {
    const instance = echarts.init(container.current!, null, { renderer: 'svg' });
    chart.current = instance;
    const resizeObserver = new ResizeObserver(() => instance.resize());
    resizeObserver.observe(container.current!);
    return () => {
      resizeObserver.disconnect();
      instance.dispose();
    };
  }, []);
  useEffect(() => {
    chart.current?.setOption(option, true);
  }, [option]);
  return <div ref={container} style={{ height, width: '100%' }} />;
}

export const Skeleton = ({ height }: { height: number }) => <div className="skeleton" style={{ height }} />;
