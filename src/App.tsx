import { useEffect } from 'react';
import { useMonths, useTerritory, useYears } from './api';
import { Breadcrumb } from './Breadcrumb';
import { Header } from './Header';
import { MapView } from './map/MapView';
import { Stats } from './stats/Stats';
import { setState, useAppState } from './state';
import { ApiStatus, Toaster } from './ui';

export default function App() {
  const state = useAppState();

  // Default period: the latest year with all its months. An old link may hold a year the API no longer offers.
  const years = useYears().data;
  const months = useMonths(state.year).data;
  useEffect(() => {
    if (years?.length && (!state.year || !years.includes(state.year))) setState({ year: Math.max(...years) });
  }, [state.year, years]);
  useEffect(() => {
    if (months?.length && (!state.monthStart || !state.monthEnd)) {
      setState({ monthStart: state.monthStart ?? months[0], monthEnd: state.monthEnd ?? months.at(-1) });
    }
  }, [months, state.monthStart, state.monthEnd]);

  const territory = useTerritory(state.type, state.code).data;
  const territoryName = state.type === 'country' ? 'Indonesia' : (territory?.name ?? '…');
  useEffect(() => {
    document.title = `${territoryName} · MapBiomas Fogo`;
  }, [territoryName]);

  return (
    <div className="grid h-full grid-rows-[44px_auto_1fr] overflow-hidden mobile:h-auto mobile:min-h-full mobile:grid-cols-[minmax(0,1fr)] mobile:grid-rows-[44px_auto_auto] mobile:overflow-auto">
      <Header currentName={territoryName} />
      <Breadcrumb type={state.type} code={state.code} name={territoryName} parentLabel={territory?.parentLabel} />
      <main className="grid min-h-0 grid-cols-[1fr_400px] mobile:grid-cols-1">
        <MapView state={state} />
        <Stats state={state} />
      </main>
      <ApiStatus />
      <Toaster />
    </div>
  );
}
