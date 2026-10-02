import type { AppState } from '../state';

export type CardDataProps = {
  state: AppState;
  /** a thematic layer the API only has nationally: numbers are summed from the features inside (`featureCodes`) */
  isDerived?: boolean;
  featureCodes?: number[];
  /** still waiting for `featureCodes` */
  isWaiting?: boolean;
  /** the request that `featureCodes` come from failed: retry that one */
  retryFeatureCodes?: () => void;
};

/** Retry handler for a failed card: either its own query or the feature-code request it depends on. */
export const retryHandler = (query: { isError: boolean; refetch: () => unknown }, retryFeatureCodes?: () => void) => {
  if (retryFeatureCodes) return retryFeatureCodes;
  return query.isError ? () => void query.refetch() : undefined;
};

export const periodOf = (state: AppState) => ({ year: state.year, monthStart: state.monthStart, monthEnd: state.monthEnd, landCover: state.landCover });
