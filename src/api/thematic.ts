import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ADMIN_TYPES } from '../state';
import { NEVER_STALE, STATISTICS, get, isPeriodReady, nationalSelection, type Period, type Selection } from './client';
import { codesInside, type InsideResult } from './inside';
import { fetchRanking, useRanking, type Area, type RankRow } from './stats';
import { useBounds, useGroupings } from './territory';

/*
 * Thematic layers are things like national parks, concessions or peatland. For each one we need to know whether it
 * has burned area inside the selected territory:
 * - "backed": the API has statistics for this territory × layer.
 * - "derived": the API only has the layer nationally. We find the layer's features that lie fully inside the
 *   territory (see inside.worker.ts) and add up their numbers ourselves.
 */

// These layers' features carry region/province codes, so at those levels the API's own answer is complete.
const LAYERS_WITH_ADMIN_CODES = new Set(['orangutanHabitat', 'tigerHabitat', 'forestMoratorium']);

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

const useFeaturesInside = (type: string, code: number, grouping: string, enabled: boolean) => {
  const corners = useBounds(type, code).data?.geometry.coordinates[0];
  return useQuery({
    queryKey: ['inside', type, code, grouping],
    queryFn: () => codesInside(type, code, grouping, corners!),
    enabled: enabled && !!corners,
    ...NEVER_STALE,
  });
};

/** Codes of the layer's features that lie fully inside the territory. */
export const useInsideCodes = (type: string, code: number, grouping: string, enabled: boolean) =>
  useFeaturesInside(type, code, grouping, enabled).data?.whole;

/** Thematic layers that can be picked as grouping for this territory. */
export function useGroupingOptions(type: string, code: number, period: Partial<Period>) {
  const territoryGroupings = useGroupings(type, code);
  const names = useGroupings('country', 1).data ?? {};
  const allLayers = Object.keys(names).filter((grouping) => !ADMIN_TYPES.has(grouping));
  const isCountry = type === 'country';
  const isAdmin = ADMIN_TYPES.has(type);

  // The groupings endpoint is unreliable below country level, so ask the statistics endpoint per layer instead.
  // A thematic territory (e.g. a national park) only has numbers for itself, so its other layers go to the geometry check.
  const layersWithData = useLayersWithData(type, code, period, isCountry || !isAdmin ? [] : allLayers);
  const backed = isCountry ? allLayers : (layersWithData.data ?? []);
  const isSettled = territoryGroupings.isSuccess && (isCountry || !isAdmin || layersWithData.isSuccess);

  // Every layer without API numbers here gets the geometry check.
  const skipCheck = type === 'region' || type === 'province' ? LAYERS_WITH_ADMIN_CODES : new Set<string>();
  const corners = useBounds(type, code).data?.geometry.coordinates[0];
  const uncoded = isSettled && !isCountry ? allLayers.filter((layer) => layer !== type && !backed.includes(layer) && !skipCheck.has(layer)) : [];

  // Two queries per layer: which features lie inside, and which features burned (national ranking).
  const checks = useQueries({
    queries: allLayers.flatMap((layer) => {
      const enabled = uncoded.includes(layer);
      const selection = nationalSelection(layer);
      return [
        { queryKey: ['inside', type, code, layer], queryFn: () => codesInside(type, code, layer, corners!), enabled: enabled && !!corners, ...NEVER_STALE },
        { queryKey: ['rank', selection, period], queryFn: () => fetchRanking(selection, period), enabled: enabled && isPeriodReady(period), ...STATISTICS },
      ];
    }),
  });
  const hasBurnedFeature = (layerIndex: number, where: keyof InsideResult) => {
    const features = (checks[2 * layerIndex].data as InsideResult | undefined)?.[where];
    const ranking = checks[2 * layerIndex + 1].data as RankRow[] | undefined;
    return !!features && !!ranking?.some((row) => row.value > 0 && features.has(row.code));
  };
  // Only offered when every burned feature touching the territory lies fully inside it. A feature that also
  // reaches outside would bring in burned area that doesn't belong to this territory.
  const derived = allLayers.filter((layer, index) => uncoded.includes(layer) && hasBurnedFeature(index, 'whole') && !hasBurnedFeature(index, 'partial'));

  return { names, backed, derived, uncoded };
}

/** Ranking for the selection. For a derived layer: the national ranking, keeping only features fully inside. */
export function useRankingFor(selection: Selection, period: Partial<Period>, isDerived: boolean) {
  const featuresInside = useFeaturesInside(selection.type, selection.code, selection.grouping, isDerived);
  const ranking = useRanking(isDerived ? nationalSelection(selection.grouping) : selection, period);
  const rows = useMemo(() => {
    if (!isDerived) return ranking.data;
    const insideCodes = featuresInside.data?.whole;
    return insideCodes && ranking.data?.filter((row) => row.value > 0 && insideCodes.has(row.code));
  }, [ranking.data, featuresInside.data, isDerived]);
  return { ...ranking, data: rows, isLoading: ranking.isLoading || (isDerived && featuresInside.isLoading) };
}
