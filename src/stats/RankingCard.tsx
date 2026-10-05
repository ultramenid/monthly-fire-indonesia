import { Fragment, useState } from 'react';
import { ChevronLeft, ChevronRight, PaintBucket } from 'lucide-react';
import { useRanking } from '../api';
import { useI18n } from '../i18n';
import { selectTerritory, setState, type AppState } from '../state';
import { Card } from './Card';
import { periodOf, retryHandler } from './cardData';

const ROWS_PER_PAGE = 10;

const pageButton =
  'grid h-7 min-w-7 place-items-center rounded border-2 border-transparent bg-surface text-xs font-bold text-muted disabled:opacity-40 aria-[current=true]:border-selected-border aria-[current=true]:bg-selected-bg aria-[current=true]:text-selected-fg';

/** Sub-territories ranked by burned area, 10 per page. Clicking one opens it. */
export function RankingCard({ state }: { state: AppState }) {
  const { labels, formatHa } = useI18n();
  const [page, setPage] = useState(1);
  const query = useRanking(state, periodOf(state));
  const rows = query.data ?? [];

  const pageCount = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = rows.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);
  const maxValue = rows[0]?.value || 1;
  // when every row has the same parent, repeating it adds nothing
  const hasMixedParents = rows.some((row) => row.parentLabel !== rows[0].parentLabel);
  // first, last, and the pages around the current one
  const visiblePages = Array.from({ length: pageCount }, (_, index) => index + 1).filter(
    (pageNumber) => pageNumber === 1 || pageNumber === pageCount || Math.abs(pageNumber - currentPage) <= 1,
  );

  return (
    <Card
      title={labels.rankTitle}
      description={labels.rankDesc}
      isLoading={query.isLoading}
      isRefreshing={query.isFetching}
      onRetry={retryHandler(query)}
      isEmpty={!query.isLoading && !rows.length}
      csvRows={() => [['position', 'code', 'name', 'parent', 'areaHa'], ...rows.map((row) => [row.position, row.code, row.name, row.parentLabel ?? '', row.value])]}
    >
      {() => (
        <>
          <button
            className={`mb-2 inline-flex h-[29px] items-center gap-1.5 rounded-full px-3 text-xs font-bold ${state.paint ? 'bg-primary-strong text-white' : 'bg-chip text-fg-2'}`}
            aria-pressed={state.paint}
            onClick={() => setState({ paint: !state.paint })}
          >
            <PaintBucket size={16} /> {state.paint ? labels.removePaint : labels.paintMap}
          </button>

          {pageRows.map((row) => (
            <button key={row.code} className="group block w-full py-0.5 text-left text-xs" onClick={() => selectTerritory(state.grouping, row.code)}>
              <span className="mb-0.5 block truncate font-bold text-fg-2">
                {row.name}
                {hasMixedParents && row.parentLabel && row.parentLabel !== 'Indonesia' && <small className="font-normal text-muted"> ({row.parentLabel})</small>}
              </span>
              <span className="flex items-center gap-2">
                <span className="h-2.5 min-w-0.5 rounded-xs bg-chart group-hover:brightness-115" style={{ width: `${(row.value / maxValue) * 70}%` }} />
                <span className="whitespace-nowrap text-fg-2">{formatHa(row.value)}</span>
              </span>
            </button>
          ))}

          <nav className="mt-2.5 flex flex-wrap justify-center gap-1.5" aria-label="pagination">
            <button className={pageButton} aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
              <ChevronLeft size={16} />
            </button>
            {visiblePages.map((pageNumber, index) => (
              <Fragment key={pageNumber}>
                {index > 0 && pageNumber - visiblePages[index - 1] > 1 && <span className="self-center text-muted">…</span>}
                <button className={pageButton} aria-current={pageNumber === currentPage} onClick={() => setPage(pageNumber)}>
                  {pageNumber}
                </button>
              </Fragment>
            ))}
            <button className={pageButton} aria-label="Next page" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>
              <ChevronRight size={16} />
            </button>
          </nav>
        </>
      )}
    </Card>
  );
}
