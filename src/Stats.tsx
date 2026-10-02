import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Download, Maximize2, PaintBucket, Share2 } from 'lucide-react';
import { useArea, useGroupingOptions, useLandCoverClasses, useLandCoverStats, useRankingFor, useTimeSeries } from './api';
import { useI18n } from './i18n';
import { ADMIN_TYPES, defaultGrouping, selectTerritory, setState, type AppState } from './state';
import { EChart, Modal, Skeleton, copyLink, downloadCsv, useTokens } from './ui';

type CardProps = {
  title: string;
  desc: string;
  csv: () => (string | number)[][];
  loading: boolean;
  /** refetching after a filter change; old data stays visible, dimmed */
  fetching?: boolean;
  empty?: boolean;
  children: (expanded: boolean) => ReactNode;
};

function Card({ title, desc, csv, loading, fetching, empty, children }: CardProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const busy = fetching && !loading;
  const body = (big: boolean) =>
    loading ? <Skeleton h={160} /> : <div className={busy ? 'busy' : undefined}>{empty ? <p className="empty">{t.noData}</p> : children(big)}</div>;
  return (
    <section className="card" aria-busy={loading || busy}>
      {busy && <div className="loader-bar" />}
      <div className="card-head">
        <h3>{title}</h3>
        <div className="card-actions">
          <button className="icon-btn accent" aria-label={t.share} onClick={() => copyLink(t.linkCopied)}>
            <Share2 size={16} />
          </button>
          <button className="icon-btn accent" aria-label={t.download} disabled={loading || empty} onClick={() => downloadCsv(`${title}.csv`, csv())}>
            <Download size={16} />
          </button>
          <button className="icon-btn accent" aria-label={t.expand} onClick={() => setExpanded(true)}>
            <Maximize2 size={16} />
          </button>
        </div>
      </div>
      <p className="card-desc">{desc}</p>
      {body(false)}
      {expanded && (
        <Modal title={title} onClose={() => setExpanded(false)}>
          {body(true)}
        </Modal>
      )}
    </section>
  );
}

const Legend = ({ value, label, color }: { value: string; label: string; color?: string }) => (
  <div className="legend">
    <i style={color ? { background: color } : undefined} />
    <div>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  </div>
);

/** `derived`: thematic layer the API only has nationally; the ranking narrows it to the features inside. */
type P = { s: AppState; derived?: boolean; codes?: number[]; pending?: boolean };
const periodOf = (s: AppState) => ({ year: s.year, monthStart: s.monthStart, monthEnd: s.monthEnd, landCover: s.landCover });

function AreaCard({ s, codes, pending }: P) {
  const { t, ha } = useI18n();
  const tok = useTokens();
  const q = useArea(s, periodOf(s), codes);
  const { data, isFetching } = q;
  const isLoading = q.isLoading || !!pending;
  const v = data?.areaHa ?? 0;
  const option = useMemo(
    () => ({
      series: [
        {
          type: 'pie',
          radius: ['62%', '76%'],
          silent: true,
          itemStyle: { color: tok.chart },
          label: {
            show: true,
            position: 'center',
            formatter: ha(v),
            color: tok.text,
            fontSize: 11,
            fontWeight: 700,
            fontFamily: 'Open Sans',
          },
          labelLine: { show: false },
          data: [{ value: v || 1, name: t.totalBurnedArea }],
        },
        {
          // invisible twin that only draws the outside callout label
          type: 'pie',
          radius: ['62%', '76%'],
          silent: true,
          startAngle: 120,
          itemStyle: { color: 'transparent' },
          label: { color: tok.text2, fontSize: 11, fontFamily: 'Open Sans' },
          labelLine: { lineStyle: { color: tok.muted }, length: 8, length2: 16 },
          data: [{ value: 1, name: t.totalBurnedArea }],
        },
      ],
    }),
    [v, tok, t, ha],
  );
  return (
    <Card title={t.burnedArea} desc={t.burnedAreaDesc} loading={isLoading} fetching={isFetching} csv={() => [['areaHa'], [v]]}>
      {(big) => (
        <>
          <EChart option={option} height={big ? 420 : 140} />
          <Legend value={ha(v)} label={t.totalArea} />
        </>
      )}
    </Card>
  );
}

function SeriesCard({ s, codes, pending }: P) {
  const { t, ha, nf, month } = useI18n();
  const tok = useTokens();
  const [mode, setMode] = useState<'monthly' | 'annual'>('monthly');
  const q = useTimeSeries(s, periodOf(s), codes);
  const { data, isFetching } = q;
  const isLoading = q.isLoading || !!pending;
  const points = useMemo(() => {
    if (!data) return [];
    return mode === 'annual'
      ? data.annual.map((a) => ({ label: String(a.year), v: a.areaHa }))
      : data.monthly
          .filter((m) => m.year < (s.year ?? 0) || (m.year === s.year && m.month <= (s.monthEnd ?? 12)))
          .map((m) => ({ label: `${month(m.month)}${data.annual.length > 1 ? ` ${String(m.year).slice(2)}` : ''}`, v: m.areaHa }));
  }, [data, mode, s.year, s.monthEnd, month]);
  const total = data?.annual.find((a) => a.year === s.year)?.areaHa ?? 0;
  const option = useMemo(
    () => ({
      grid: { left: 36, right: 4, top: 20, bottom: 20 },
      tooltip: { confine: true, trigger: 'axis', valueFormatter: (v: number) => ha(v), backgroundColor: tok.bg, borderColor: tok.border, textStyle: { color: tok.text } },
      xAxis: {
        type: 'category',
        data: points.map((p) => p.label),
        axisLine: { lineStyle: { color: tok.border } },
        axisTick: { show: false },
        axisLabel: { color: tok.muted, fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        name: 'ha',
        nameTextStyle: { color: tok.muted, fontSize: 10, align: 'right' },
        splitLine: { show: false },
        axisLabel: { color: tok.muted, fontSize: 10, formatter: (v: number) => (v >= 1000 ? `${nf.format(v / 1000)}K` : v) },
      },
      series: [{ type: 'bar', data: points.map((p) => p.v), itemStyle: { color: tok.chart }, barMaxWidth: 24 }],
    }),
    [points, tok, ha, nf],
  );
  return (
    <Card
      title={t.burnedArea}
      desc={t.burnedSeriesDesc}
      loading={isLoading}
      fetching={isFetching}
      empty={!isLoading && !points.length}
      csv={() => [['period', 'areaHa'], ...points.map((p) => [p.label, p.v])]}
    >
      {(big) => (
        <>
          <div className="toggle">
            <button aria-pressed={mode === 'monthly'} onClick={() => setMode('monthly')}>
              {t.monthly}
            </button>
            /
            <button aria-pressed={mode === 'annual'} onClick={() => setMode('annual')}>
              {t.annual}
            </button>
          </div>
          <EChart option={option} height={big ? 440 : 180} />
          <Legend value={ha(total)} label={`${t.totalBurnedIn} ${s.year}`} />
        </>
      )}
    </Card>
  );
}

function LandCoverCard({ s, codes, pending }: P) {
  const { t, ha, name } = useI18n();
  const tok = useTokens();
  const [level, setLevel] = useState(1);
  const q = useLandCoverStats(s, periodOf(s), level, codes);
  const { data, isFetching } = q;
  const isLoading = q.isLoading || !!pending;
  const classes = useLandCoverClasses().data;
  const rows = useMemo(() => (data ?? []).filter((r) => r.areaHa > 0), [data]);
  const option = useMemo(
    () => ({
      tooltip: { confine: true, trigger: 'item', valueFormatter: (v: number) => ha(v), backgroundColor: tok.bg, borderColor: tok.border, textStyle: { color: tok.text } },
      series: [
        {
          type: 'pie',
          radius: '62%',
          label: { color: tok.text2, fontSize: 11, overflow: 'break', width: 80, alignTo: 'edge', edgeDistance: 4 },
          labelLine: { lineStyle: { color: tok.muted } },
          data: rows.map((r) => ({
            name: name(r),
            value: r.areaHa,
            itemStyle: { color: classes?.find((c) => c.id === r.id)?.color ?? tok.chart },
          })),
        },
      ],
    }),
    [rows, classes, tok, name, ha],
  );
  return (
    <Card
      title={t.lcTitle}
      desc={t.lcDesc}
      loading={isLoading}
      fetching={isFetching}
      empty={!isLoading && !rows.length}
      csv={() => [['id', 'class', 'areaHa'], ...rows.map((r) => [r.id, name(r), r.areaHa])]}
    >
      {(big) => (
        <>
          <div className="tabs" role="tablist">
            {[1, 2, 3, 4].map((l) => (
              <button key={l} role="tab" aria-selected={l === level} onClick={() => setLevel(l)}>
                {t.level} {l}
              </button>
            ))}
          </div>
          <EChart option={option} height={big ? 440 : 210} />
        </>
      )}
    </Card>
  );
}

const PAGE = 10;
function RankingCard({ s, derived }: P) {
  const { t, ha } = useI18n();
  const [page, setPage] = useState(1);
  const { data = [], isLoading, isFetching } = useRankingFor(s, periodOf(s), !!derived);
  const pages = Math.max(1, Math.ceil(data.length / PAGE));
  const cur = Math.min(page, pages);
  const max = data[0]?.value || 1;
  const rows = data.slice((cur - 1) * PAGE, cur * PAGE);
  // inside one parent every row repeats it; only show parents when they differ
  const mixedParents = data.some((r) => r.parentLabel !== data[0].parentLabel);
  return (
    <Card
      title={t.rankTitle}
      desc={t.rankDesc}
      loading={isLoading}
      fetching={isFetching}
      empty={!isLoading && !data.length}
      csv={() => [['position', 'code', 'name', 'parent', 'areaHa'], ...data.map((r) => [r.position, r.code, r.name, r.parentLabel ?? '', r.value])]}
    >
      {() => (
        <>
          <button className="paint-btn" aria-pressed={s.paint} onClick={() => setState({ paint: !s.paint })}>
            <PaintBucket size={16} /> {s.paint ? t.removePaint : t.paintMap}
          </button>
          {rows.map((r) => (
            <button key={r.code} className="rank-row" onClick={() => selectTerritory(s.grouping, r.code)}>
              <span className="rank-name">
                {r.name}
                {mixedParents && r.parentLabel && r.parentLabel !== 'Indonesia' && <small> ({r.parentLabel})</small>}
              </span>
              <span className="rank-line">
                <span className="rank-bar" style={{ width: `${(r.value / max) * 70}%` }} />
                <span>{ha(r.value)}</span>
              </span>
            </button>
          ))}
          <nav className="pager" aria-label="pagination">
            <button aria-label="Previous page" disabled={cur === 1} onClick={() => setPage(cur - 1)}>
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: pages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === pages || Math.abs(p - cur) <= 1)
              .map((p, i, shown) => (
                <Fragment key={p}>
                  {i > 0 && p - shown[i - 1] > 1 && <span className="pager-gap">…</span>}
                  <button aria-current={p === cur} onClick={() => setPage(p)}>
                    {p}
                  </button>
                </Fragment>
              ))}
            <button aria-label="Next page" disabled={cur === pages} onClick={() => setPage(cur + 1)}>
              <ChevronRight size={16} />
            </button>
          </nav>
        </>
      )}
    </Card>
  );
}

/** Drives both the map's sub-territory layer and the ranking card. */
/** Admin levels are reached by drilling, so the select only offers the drill default plus this area's thematic layers. */
function GroupingSelect({ s, opts }: P & { opts: ReturnType<typeof useGroupingOptions> }) {
  const { t, name } = useI18n();
  const def = defaultGrouping(s.type);
  const listed = [...opts.backed, ...opts.derived].filter((g) => g !== def);
  if (s.grouping !== def && !listed.includes(s.grouping)) listed.push(s.grouping); // keep the current choice visible
  const thematic = listed.sort((a, b) => Object.keys(opts.names).indexOf(a) - Object.keys(opts.names).indexOf(b));
  return (
    <label className={`group-select${s.grouping !== def ? ' active' : ''}`}>
      {t.groupedBy}
      <select value={s.grouping} disabled={!thematic.length && s.grouping === def} onChange={(e) => setState({ grouping: e.target.value })}>
        <option value={def}>
          {!ADMIN_TYPES.has(s.type) ? name(opts.names[def] as never) || def : opts.names[def] ? `${t.adminGroup} · ${name(opts.names[def] as never)}` : t.adminGroup}
        </option>
        {thematic.map((g) => (
          <option key={g} value={g}>
            {name(opts.names[g] as never) || g}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Stats({ s }: P) {
  const { t } = useI18n();
  const opts = useGroupingOptions(s.type, s.code, periodOf(s));
  const derived = opts.uncoded.includes(s.grouping);
  const own = !ADMIN_TYPES.has(s.type);
  // the opened thematic territory on its own layer: its own numbers. A derived layer: summed from its burned features
  // that lie wholly inside (the ranking rows). Otherwise the API has territory × layer numbers.
  const self = own && s.grouping === s.type;
  const rank = useRankingFor(s, periodOf(s), derived);
  const codes = derived ? rank.data?.map((r) => r.code) : undefined;
  const cs = own && !derived ? { ...s, grouping: s.type } : s;
  const sum = { s: cs, codes, pending: derived && !codes };
  return (
    <aside className="side">
      <div className="side-head">
        <h2>{t.statistics}</h2>
        <GroupingSelect s={s} opts={opts} />
      </div>
      <AreaCard {...sum} />
      <SeriesCard {...sum} />
      {/* on its own layer the API ranks the whole country, which says nothing about the opened territory */}
      {!self && <RankingCard key={`${s.type}/${s.code}/${s.grouping}`} s={s} derived={derived} />}
      <LandCoverCard {...sum} />
    </aside>
  );
}
