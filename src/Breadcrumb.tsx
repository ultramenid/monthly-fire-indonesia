import { Fragment } from 'react';
import { Undo2 } from 'lucide-react';
import { useTerritory } from './api';
import { useI18n } from './i18n';
import { selectTerritory } from './state';

type Ref = { type: string; code: number };

// Province code's first digit → region code (BPS numbering; verified against /ranking/country/1/region).
const REGION_OF: Record<string, number> = { 1: 1, 2: 1, 3: 2, 5: 4, 6: 3, 7: 5, 8: 6, 9: 7 };

/** Admin ancestors derived from nested BPS codes. Villages / thematic areas fall back to parentLabel. */
export function ancestors({ type, code }: Ref): Ref[] {
  const s = String(code);
  const province = (p: string): Ref[] => [{ type: 'region', code: REGION_OF[p[0]] }, { type: 'province', code: +p }];
  switch (type) {
    case 'province':
      return province(s).slice(0, 1);
    case 'regency':
      return province(s.slice(0, 2));
    case 'district':
      return [...province(s.slice(0, 2)), { type: 'regency', code: +s.slice(0, 4) }];
    default:
      return [];
  }
}

function Crumb({ r }: { r: Ref }) {
  const { data } = useTerritory(r.type, r.code);
  return (
    <button className="crumb" onClick={() => selectTerritory(r.type, r.code)}>
      {data?.name ?? '…'}
    </button>
  );
}

export function Breadcrumb({ type, code, name, parentLabel }: Ref & { name: string; parentLabel?: string | null }) {
  const { t } = useI18n();
  const isRoot = type === 'country';
  const chain: Ref[] = isRoot ? [] : [{ type: 'country', code: 1 }, ...ancestors({ type, code })];
  const parent = chain.at(-1);
  // parentLabel adds the one level we can't derive from codes (village → district, thematic areas)
  const extra = !isRoot && ancestors({ type, code }).length === 0 && parentLabel && parentLabel !== 'Indonesia' ? parentLabel : null;

  return (
    <nav className="crumbs" aria-label="breadcrumb">
      {parent && (
        <button className="back" aria-label={t.back} onClick={() => selectTerritory(parent.type, parent.code)}>
          <Undo2 size={16} />
        </button>
      )}
      {chain.map((r) => (
        <Fragment key={`${r.type}:${r.code}`}>
          <Crumb r={r} />
          <span className="sep">/</span>
        </Fragment>
      ))}
      {extra && (
        <>
          <span className="crumb" style={{ color: 'var(--muted)', fontWeight: 400 }}>
            {extra}
          </span>
          <span className="sep">/</span>
        </>
      )}
      <span className="current">{name}</span>
    </nav>
  );
}
