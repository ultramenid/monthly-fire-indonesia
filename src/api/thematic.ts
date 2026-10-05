import { useQuery } from '@tanstack/react-query';
import { ADMIN_TYPES } from '../state';
import { STATISTICS, get, isPeriodReady, type Period } from './client';
import type { Area } from './stats';
import { useGroupings } from './territory';

/*
 * Thematic layers are things like national parks, concessions or peatland. A layer is only offered for a territory
 * when the API itself has burned-area statistics for that territory × layer. We never compute numbers ourselves.
 */

/** Which of `layers` the API has burned-area numbers for in this territory and period. */
const useLayersWithData = (type: string, code: number, period: Partial<Period>, layers: string[]) =>
  useQuery({
    queryKey: ['thematicData', type, code, period, layers],
    queryFn: async () => {
      const hasData = await Promise.all(
        layers.map((layer) =>
          get<Area>(`/statistics/area/${type}/${code}/${layer}`, period).then(
            (area) => area.areaHa != null,
            () => false,
          ),
        ),
      );
      return layers.filter((_, index) => hasData[index]);
    },
    enabled: isPeriodReady(period) && layers.length > 0,
    ...STATISTICS,
    // no "keep previous data": the previous territory's layers would show up here
    placeholderData: undefined,
  });

/** Thematic layers that can be picked as grouping for this territory. */
export function useGroupingOptions(type: string, code: number, period: Partial<Period>) {
  const layerNames = useGroupings('country', 1);
  const names = layerNames.data ?? {};
  const allLayers = Object.keys(names).filter((grouping) => !ADMIN_TYPES.has(grouping));
  const isCountry = type === 'country';
  const isAdmin = ADMIN_TYPES.has(type);

  // The groupings endpoint is unreliable below country level, so ask the statistics endpoint per layer instead.
  // A thematic territory (e.g. a national park) only has numbers for itself, so it offers no other layers.
  const layersWithData = useLayersWithData(type, code, period, isAdmin && !isCountry ? allLayers : []);
  const backed = isCountry ? allLayers : isAdmin ? (layersWithData.data ?? []) : [];
  const isSettled = layerNames.isSuccess && (isCountry || !isAdmin || layersWithData.isSuccess);

  return { names, backed, isSettled };
}
