import type { AppState } from '../state';

export type CardDataProps = { state: AppState };

/** Retry handler for a failed card. */
export const retryHandler = (query: { isError: boolean; refetch: () => unknown }) => (query.isError ? () => void query.refetch() : undefined);

export const periodOf = (state: AppState) => ({ year: state.year, monthStart: state.monthStart, monthEnd: state.monthEnd, landCover: state.landCover });
