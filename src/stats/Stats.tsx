import { useI18n } from '../i18n';
import { ADMIN_TYPES, type AppState } from '../state';
import { AreaCard } from './AreaCard';
import { LandCoverCard } from './LandCoverCard';
import { RankingCard } from './RankingCard';
import { SeriesCard } from './SeriesCard';

export function Stats({ state }: { state: AppState }) {
  const { labels } = useI18n();
  const isThematicTerritory = !ADMIN_TYPES.has(state.type);
  const isGroupedBySelf = isThematicTerritory && state.grouping === state.type;
  // a thematic territory (e.g. a national park) has its own numbers when grouped by its own layer
  const chartProps = { state: isThematicTerritory ? { ...state, grouping: state.type } : state };

  return (
    <aside className="overflow-y-auto border-l bg-bg p-4 mobile:overflow-visible mobile:border-l-0">
      <div className="sticky -top-4 z-2 -mx-4 -mt-4 mb-3 flex items-center justify-between gap-2 bg-bg px-4 pt-4 pb-3">
        <h2 className="text-base font-bold">{labels.statistics}</h2>
      </div>
      <AreaCard {...chartProps} />
      <SeriesCard {...chartProps} />
      {/* grouped by its own layer the API ranks the whole country, which says nothing about this territory */}
      {!isGroupedBySelf && <RankingCard key={`${state.type}/${state.code}/${state.grouping}`} state={state} />}
      <LandCoverCard {...chartProps} />
    </aside>
  );
}
