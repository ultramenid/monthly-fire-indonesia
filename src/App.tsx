import { useEffect } from 'react';
import { useMonths, useTerritory, useYears } from './api';
import { Breadcrumb } from './Breadcrumb';
import { Header } from './Header';
import { MapView } from './MapView';
import { Stats } from './Stats';
import { setState, useAppState } from './state';
import { Toaster } from './ui';

export default function App() {
  const s = useAppState();

  // default period: latest year, all available months
  const years = useYears().data;
  const months = useMonths(s.year).data;
  useEffect(() => {
    if (!s.year && years?.length) setState({ year: Math.max(...years) });
  }, [s.year, years]);
  useEffect(() => {
    if (months?.length && (!s.monthStart || !s.monthEnd)) setState({ monthStart: s.monthStart ?? months[0], monthEnd: s.monthEnd ?? months.at(-1) });
  }, [months, s.monthStart, s.monthEnd]);

  const territory = useTerritory(s.type, s.code).data;
  const name = s.type === 'country' ? 'Indonesia' : (territory?.name ?? '…');
  useEffect(() => void (document.title = `${name} · MapBiomas Fogo`), [name]);

  return (
    <div className="app">
      <Header currentName={name} />
      <Breadcrumb type={s.type} code={s.code} name={name} parentLabel={territory?.parentLabel} />
      <main className="main">
        <MapView s={s} />
        <Stats s={s} />
      </main>
      <Toaster />
    </div>
  );
}
