import { useMemo } from 'react';
import { useArea } from '../api';
import { useI18n } from '../i18n';
import { useTokens } from '../hooks';
import { EChart } from '../ui';
import { Card, Legend } from './Card';
import { periodOf, retryHandler, type CardDataProps } from './cardData';

/** Total burned area as a ring with the number in the middle. */
export function AreaCard({ state, featureCodes, isWaiting, retryFeatureCodes }: CardDataProps) {
  const { labels, formatHa } = useI18n();
  const tokens = useTokens();
  const query = useArea(state, periodOf(state), featureCodes);
  const burnedHa = query.data?.areaHa ?? 0;

  const chartOption = useMemo(
    () => ({
      series: [
        {
          type: 'pie',
          radius: ['62%', '76%'],
          silent: true,
          itemStyle: { color: tokens.chart },
          label: { show: true, position: 'center', formatter: formatHa(burnedHa), color: tokens.text, fontSize: 11, fontWeight: 700, fontFamily: 'Open Sans' },
          labelLine: { show: false },
          data: [{ value: burnedHa || 1, name: labels.totalBurnedArea }],
        },
        {
          // invisible copy of the ring that only draws the label outside it
          type: 'pie',
          radius: ['62%', '76%'],
          silent: true,
          startAngle: 120,
          itemStyle: { color: 'transparent' },
          label: { color: tokens.text2, fontSize: 11, fontFamily: 'Open Sans' },
          labelLine: { lineStyle: { color: tokens.muted }, length: 8, length2: 16 },
          data: [{ value: 1, name: labels.totalBurnedArea }],
        },
      ],
    }),
    [burnedHa, tokens, labels, formatHa],
  );

  return (
    <Card
      title={labels.burnedArea}
      description={labels.burnedAreaDesc}
      isLoading={query.isLoading || !!isWaiting}
      isRefreshing={query.isFetching}
      onRetry={retryHandler(query, retryFeatureCodes)}
      csvRows={() => [['areaHa'], [burnedHa]]}
    >
      {(isExpanded) => (
        <>
          <EChart option={chartOption} height={isExpanded ? 420 : 140} />
          <Legend value={formatHa(burnedHa)} label={labels.totalArea} />
        </>
      )}
    </Card>
  );
}
