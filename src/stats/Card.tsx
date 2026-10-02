import { useState, type ReactNode } from 'react';
import { Download, Maximize2, Share2 } from 'lucide-react';
import { useI18n } from '../i18n';
import { copyLink, downloadCsv } from '../lib/browser';
import { Modal, Skeleton } from '../ui';

type CardProps = {
  title: string;
  description: string;
  csvRows: () => (string | number)[][];
  isLoading: boolean;
  /** refetching after a filter change: the old chart stays visible, dimmed */
  isRefreshing?: boolean;
  isEmpty?: boolean;
  /** set when the request failed: shows an error with a retry button */
  onRetry?: () => void;
  children: (isExpanded: boolean) => ReactNode;
};

export function Card({ title, description, csvRows, isLoading, isRefreshing, isEmpty, onRetry, children }: CardProps) {
  const { labels } = useI18n();
  const [isExpanded, setExpanded] = useState(false);
  const isDimmed = isRefreshing && !isLoading;

  const body = (expanded: boolean) => {
    if (onRetry) {
      return (
        <p className="empty">
          {labels.error}{' '}
          <button className="link-btn" onClick={onRetry}>
            {labels.retry}
          </button>
        </p>
      );
    }
    if (isLoading) return <Skeleton height={160} />;
    return (
      <div className={isDimmed ? 'opacity-45 transition-opacity' : undefined}>
        {isEmpty ? <p className="empty">{labels.noData}</p> : children(expanded)}
      </div>
    );
  };

  const actionButton = 'icon-btn size-7 text-accent-icon disabled:opacity-40';
  return (
    <section className="relative mb-3 rounded-xl border p-3 text-fg-2" aria-busy={isLoading || isDimmed}>
      {isDimmed && <div className="loader-bar inset-x-3 z-1" />}
      <div className="flex items-start justify-between gap-2">
        <h3 className="mt-1 leading-[1.4] font-bold">{title}</h3>
        <div className="flex">
          <button className={actionButton} aria-label={labels.share} onClick={() => copyLink(labels.linkCopied)}>
            <Share2 size={16} />
          </button>
          <button
            className={actionButton}
            aria-label={labels.download}
            disabled={isLoading || isEmpty || !!onRetry}
            onClick={() => downloadCsv(`${title}.csv`, csvRows())}
          >
            <Download size={16} />
          </button>
          <button className={actionButton} aria-label={labels.expand} onClick={() => setExpanded(true)}>
            <Maximize2 size={16} />
          </button>
        </div>
      </div>
      <p className="mt-1 mb-2 text-xs leading-[1.4] text-muted">{description}</p>
      {body(false)}
      {isExpanded && (
        <Modal title={title} onClose={() => setExpanded(false)}>
          {body(true)}
        </Modal>
      )}
    </section>
  );
}

export const Legend = ({ value, label }: { value: string; label: string }) => (
  <div className="mt-2 flex items-start gap-2.5 text-xs">
    <i className="mt-px size-3 shrink-0 rounded-full bg-chart" />
    <div>
      <b className="block text-fg-2">{value}</b>
      <span className="text-muted">{label}</span>
    </div>
  </div>
);
