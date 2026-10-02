import { useMemo, useState } from 'react';
import { useLandCoverClasses, useLandCoverStats } from '../api';
import { useI18n } from '../i18n';
import { useTokens } from '../hooks';
import { EChart } from '../ui';
import { Card } from './Card';
import { periodOf, retryHandler, type CardDataProps } from './cardData';

const LEVELS = [1, 2, 3, 4];

/** Burned area split by land cover class, at the chosen detail level. */
export function LandCoverCard({ state, featureCodes, isWaiting, retryFeatureCodes }: CardDataProps) {
  const { labels, formatHa, name } = useI18n();
  const tokens = useTokens();
  const [level, setLevel] = useState(1);
  const query = useLandCoverStats(state, periodOf(state), level, featureCodes);
  const isLoading = query.isLoading || !!isWaiting;
  const classes = useLandCoverClasses().data;
  const rows = useMemo(() => (query.data ?? []).filter((row) => row.areaHa > 0), [query.data]);

  const chartOption = useMemo(
    () => ({
      tooltip: {
        confine: true,
        trigger: 'item',
        valueFormatter: (value: number) => formatHa(value),
        backgroundColor: tokens.bg,
        borderColor: tokens.border,
        textStyle: { color: tokens.text },
      },
      series: [
        {
          type: 'pie',
          radius: '62%',
          label: { color: tokens.text2, fontSize: 11, overflow: 'break', width: 80, alignTo: 'edge', edgeDistance: 4 },
          labelLine: { lineStyle: { color: tokens.muted } },
          data: rows.map((row) => ({
            name: name(row),
            value: row.areaHa,
            itemStyle: { color: classes?.find((landCoverClass) => landCoverClass.id === row.id)?.color ?? tokens.chart },
          })),
        },
      ],
    }),
    [rows, classes, tokens, name, formatHa],
  );

  return (
    <Card
      title={labels.lcTitle}
      description={labels.lcDesc}
      isLoading={isLoading}
      isRefreshing={query.isFetching}
      onRetry={retryHandler(query, retryFeatureCodes)}
      isEmpty={!isLoading && !rows.length}
      csvRows={() => [['id', 'class', 'areaHa'], ...rows.map((row) => [row.id, name(row), row.areaHa])]}
    >
      {(isExpanded) => (
        <>
          <div className="mb-1 flex gap-3 text-xs" role="tablist">
            {LEVELS.map((option) => (
              <button
                key={option}
                className="border-b-2 border-transparent py-1 text-fg-2 aria-selected:border-primary aria-selected:text-primary"
                role="tab"
                aria-selected={option === level}
                onClick={() => setLevel(option)}
              >
                {labels.level} {option}
              </button>
            ))}
          </div>
          <EChart option={chartOption} height={isExpanded ? 440 : 210} />
        </>
      )}
    </Card>
  );
}
