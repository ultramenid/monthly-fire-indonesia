import { useMemo, useState } from 'react';
import { useTimeSeries } from '../api';
import { useI18n } from '../i18n';
import { useTokens } from '../hooks';
import { EChart } from '../ui';
import { Card, Legend } from './Card';
import { periodOf, retryHandler, type CardDataProps } from './cardData';

/** Burned area per month (or per year) as a bar chart. */
export function SeriesCard({ state }: CardDataProps) {
  const { labels, formatHa, numberFormat, monthName } = useI18n();
  const tokens = useTokens();
  const [mode, setMode] = useState<'monthly' | 'annual'>('monthly');
  const query = useTimeSeries(state, periodOf(state));
  const series = query.data;
  const isLoading = query.isLoading;

  const bars = useMemo(() => {
    if (!series) return [];
    if (mode === 'annual') return series.annual.map((year) => ({ label: String(year.year), value: year.areaHa }));
    const showYear = series.annual.length > 1;
    return series.monthly
      .filter((month) => month.year < (state.year ?? 0) || (month.year === state.year && month.month <= (state.monthEnd ?? 12)))
      .map((month) => ({ label: `${monthName(month.month)}${showYear ? ` ${String(month.year).slice(2)}` : ''}`, value: month.areaHa }));
  }, [series, mode, state.year, state.monthEnd, monthName]);
  const totalThisYear = series?.annual.find((year) => year.year === state.year)?.areaHa ?? 0;

  const chartOption = useMemo(
    () => ({
      grid: { left: 36, right: 4, top: 20, bottom: 20 },
      tooltip: {
        confine: true,
        trigger: 'axis',
        valueFormatter: (value: number) => formatHa(value),
        backgroundColor: tokens.bg,
        borderColor: tokens.border,
        textStyle: { color: tokens.text },
      },
      xAxis: {
        type: 'category',
        data: bars.map((bar) => bar.label),
        axisLine: { lineStyle: { color: tokens.border } },
        axisTick: { show: false },
        axisLabel: { color: tokens.muted, fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        name: 'ha',
        nameTextStyle: { color: tokens.muted, fontSize: 10, align: 'right' },
        splitLine: { show: false },
        axisLabel: { color: tokens.muted, fontSize: 10, formatter: (value: number) => (value >= 1000 ? `${numberFormat.format(value / 1000)}K` : value) },
      },
      series: [{ type: 'bar', data: bars.map((bar) => bar.value), itemStyle: { color: tokens.chart }, barMaxWidth: 24 }],
    }),
    [bars, tokens, formatHa, numberFormat],
  );

  const toggleButton = 'h-[26px] rounded-lg px-3 text-xs font-bold text-muted aria-pressed:bg-chip';
  return (
    <Card
      title={labels.burnedArea}
      description={labels.burnedSeriesDesc}
      isLoading={isLoading}
      isRefreshing={query.isFetching}
      onRetry={retryHandler(query)}
      isEmpty={!isLoading && !bars.length}
      csvRows={() => [['period', 'areaHa'], ...bars.map((bar) => [bar.label, bar.value])]}
    >
      {(isExpanded) => (
        <>
          <div className="mb-1 flex items-center gap-2 text-muted">
            <button className={toggleButton} aria-pressed={mode === 'monthly'} onClick={() => setMode('monthly')}>
              {labels.monthly}
            </button>
            /
            <button className={toggleButton} aria-pressed={mode === 'annual'} aria-label={labels.annual} onClick={() => setMode('annual')}>
              {state.year ?? labels.annual}
            </button>
          </div>
          <EChart option={chartOption} height={isExpanded ? 440 : 180} />
          <Legend value={formatHa(totalThisYear)} label={`${labels.totalBurnedIn} ${state.year}`} />
        </>
      )}
    </Card>
  );
}
