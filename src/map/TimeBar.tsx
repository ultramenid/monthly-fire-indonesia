import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { useMonths, useYears } from '../api';
import { useI18n } from '../i18n';
import { setState, type AppState } from '../state';
import { Dropdown } from './Dropdown';

type Thumb = 'start' | 'end';

/** Year picker plus a two-thumb slider for the month range. */
export function TimeBar({ state }: { state: AppState }) {
  const { labels, monthName } = useI18n();
  const years = useYears().data ?? [];
  const months = useMonths(state.year).data ?? [];

  // While dragging, only this local draft changes. The real state (which refetches stats and tiles) updates on release.
  const [draft, setDraft] = useState<[number, number] | null>(null);
  const savedStart = Math.max(0, months.indexOf(state.monthStart ?? -1));
  const savedEnd = Math.max(0, months.indexOf(state.monthEnd ?? -1));
  const [startIndex, endIndex] = draft ?? [savedStart, savedEnd];

  // When both thumbs sit on the same month, the drag direction decides which one moves.
  const draggedThumb = useRef<Thumb | null>(null);
  const onSlide = (thumb: Thumb, index: number) => {
    if (!draggedThumb.current) {
      if (startIndex !== endIndex) draggedThumb.current = thumb;
      else if (index === startIndex) return;
      else draggedThumb.current = index < startIndex ? 'start' : 'end';
    }
    setDraft(draggedThumb.current === 'start' ? [Math.min(index, endIndex), endIndex] : [startIndex, Math.max(index, startIndex)]);
  };
  const commit = () => {
    draggedThumb.current = null;
    if (!draft) return;
    setDraft(null);
    const [monthStart, monthEnd] = [months[draft[0]], months[draft[1]]];
    if (monthStart !== state.monthStart || monthEnd !== state.monthEnd) setState({ monthStart, monthEnd });
  };
  // the pointer often leaves the slider before it's released, so listen on the whole window
  useEffect(() => {
    if (!draft) return;
    addEventListener('pointerup', commit);
    return () => removeEventListener('pointerup', commit);
  });

  // A thumb's center moves between 12px and (width - 12px), so the fill and ticks use that span too.
  const fraction = (index: number) => (months.length > 1 ? index / (months.length - 1) : 0);
  const position = (index: number) => `calc(12px + (100% - 24px) * ${fraction(index)})`;
  const sliderProps = { type: 'range', min: 0, max: months.length - 1, onKeyUp: commit, onBlur: commit };

  return (
    <div className="relative flex h-10 items-center rounded-lg bg-bg">
      <Dropdown
        className="contents"
        trigger={(isOpen, toggle) => (
          <button className="inline-flex h-[37px] items-center gap-2 rounded-lg px-4 font-bold hover:bg-chip" aria-expanded={isOpen} onClick={toggle}>
            {state.year ?? '—'} <ChevronDown size={16} />
          </button>
        )}
      >
        {(close) => (
          <div className="pop bottom-12 left-0 w-[220px]" role="menu" aria-label={labels.selectYear}>
            <div className="px-3 pt-2.5 pb-2 text-xs font-bold text-fg-2">{labels.selectYear}</div>
            <div className="grid max-h-60 grid-cols-3 gap-1.5 overflow-y-auto border-t p-2.5">
              {years.map((year) => (
                <button
                  key={year}
                  className="h-[34px] rounded-lg font-semibold text-fg-2 tabular-nums hover:bg-surface-2 hover:text-fg aria-checked:bg-primary/16 aria-checked:text-accent-text aria-checked:shadow-[inset_0_0_0_1px_var(--primary)]"
                  role="menuitemradio"
                  aria-checked={year === state.year}
                  onClick={() => {
                    if (year !== state.year) setState({ year, monthStart: undefined, monthEnd: undefined });
                    close();
                  }}
                >
                  {year}
                </button>
              ))}
            </div>
          </div>
        )}
      </Dropdown>
      <span className="h-6 w-px bg-border" />
      <span className="inline-flex items-center gap-2 pr-2 pl-4 font-bold whitespace-nowrap">
        <CalendarDays size={20} />
        {months.length > 0 && monthName(months[startIndex])}
        {endIndex !== startIndex && <> – {monthName(months[endIndex])}</>}
      </span>
      <div className="month-range relative mr-5 ml-3 h-[30px] w-[520px] max-[1180px]:w-[300px] mobile:w-[calc(100vw-260px)] mobile:min-w-[120px]">
        <div className="absolute inset-x-3 top-[13px] h-1 rounded bg-chip" />
        <div
          className="absolute top-[11px] h-2 rounded bg-primary"
          style={{ left: position(startIndex), width: `calc((100% - 24px) * ${fraction(endIndex) - fraction(startIndex)})` }}
        />
        {months.map((month, index) => (
          <div key={month} className="absolute top-[14px] size-0.5 -translate-x-px rounded-full bg-dot" style={{ left: position(index) }} />
        ))}
        {months.length > 0 && (
          <>
            <input aria-label="Start month" {...sliderProps} value={startIndex} onChange={(event) => onSlide('start', Number(event.target.value))} />
            <input aria-label="End month" {...sliderProps} value={endIndex} onChange={(event) => onSlide('end', Number(event.target.value))} />
          </>
        )}
      </div>
    </div>
  );
}
