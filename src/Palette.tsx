import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { CornerDownLeft, MapPin, Search, X } from 'lucide-react';
import { useSearch, useTypeNames, type Territory } from './api';
import { useI18n } from './i18n';
import { selectTerritory } from './state';

// Admin levels always get a chip (even at 0) so the hierarchy is visible; other types appear when they match.
const ADMIN = ['province', 'regency', 'district', 'village'];
// 2-letter queries can return ~9k rows; rendering them all as cmdk items freezes the page
const CAP = 50;
const CAP_ONE = 200;

/** Cmd+K territory search: type chips with counts, results grouped by type, keyboard-driven. */
export function Palette({ onClose }: { onClose: () => void }) {
  const { t, name } = useI18n();
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<string | null>(null);
  const { data: types = [] } = useTypeNames();
  const [term, setTerm] = useState(''); // debounced q: one request per pause, not per keystroke
  useEffect(() => {
    const id = setTimeout(() => setTerm(q), 250);
    return () => clearTimeout(id);
  }, [q]);
  const enabled = q.trim().length > 1;
  const { data = [], isFetching } = useSearch(term);
  const results = enabled ? data : [];
  const loading = enabled && (isFetching || q !== term);

  // types in API hierarchy order (translations endpoint lists them country → region → … → thematic)
  const order = types.map((x) => x.type);
  const groups = new Map<string, Territory[]>();
  for (const r of [...results].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))) {
    const g = groups.get(r.type);
    if (g) g.push(r);
    else groups.set(r.type, [r]);
  }
  const chips = order.filter((ty) => ADMIN.includes(ty) || groups.has(ty));
  const typeName = (ty: string) => name(types.find((x) => x.type === ty)) || ty;
  const shown = only ? [[only, groups.get(only) ?? []] as const] : [...groups];
  const count = shown.reduce((n, [, rows]) => n + rows.length, 0);

  const pick = (r: Territory) => {
    selectTerritory(r.type, r.code);
    onClose();
  };
  const chip = (label: string, n: number, type: string | null) => (
    <button
      key={label}
      className="palette-chip"
      aria-pressed={only === type}
      onMouseDown={(e) => e.preventDefault()} // keep focus in the input
      onClick={() => setOnly(type)}
    >
      {label} <span>{n}</span>
    </button>
  );

  return (
    <div className="overlay palette-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <Command
        key={only ?? ''} // remount on chip change so the first visible row is selected again
        className="palette"
        shouldFilter={false}
        loop
        label={t.search}
        onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), onClose())}
      >
        <div className="palette-input">
          <Search size={20} />
          <Command.Input autoFocus value={q} onValueChange={(v) => (setQ(v), setOnly(null))} placeholder={t.paletteHint} />
          <button className="icon-btn" aria-label={t.close} onClick={onClose}>
            <X size={20} />
          </button>
          {loading && <div className="loader-bar" />}
        </div>
        {enabled && (
          <div className="palette-chips">
            {chip(t.allGroups, results.length, null)}
            {chips.map((ty) => chip(typeName(ty), groups.get(ty)?.length ?? 0, ty))}
          </div>
        )}
        <Command.List className={`palette-list${loading && count ? ' busy' : ''}`}>
          {!enabled && <div className="palette-empty">{t.typeToSearch}</div>}
          {loading && !count && <Command.Loading className="palette-empty">{t.searching}</Command.Loading>}
          {enabled && !loading && count === 0 && <div className="palette-empty">{t.noResults}</div>}
          {shown.map(([ty, rows]) =>
            rows.length ? (
              <Command.Group key={ty} heading={`${typeName(ty)} · ${rows.length}`}>
                {rows.slice(0, only ? CAP_ONE : CAP).map((r) => (
                  <Command.Item key={`${r.type}:${r.code}`} value={`${r.type}:${r.code}`} onSelect={() => pick(r)}>
                    <MapPin size={18} className="palette-pin" />
                    <span className="palette-name">{r.name}</span>
                    {r.parentLabel && <small>{r.parentLabel}</small>}
                    <CornerDownLeft size={16} className="palette-enter" />
                  </Command.Item>
                ))}
                {rows.length > (only ? CAP_ONE : CAP) && (
                  <div className="palette-more">
                    +{rows.length - (only ? CAP_ONE : CAP)} · {t.refineSearch}
                  </div>
                )}
              </Command.Group>
            ) : null,
          )}
        </Command.List>
        <div className="palette-foot">
          <span>{t.paletteKeys}</span>
          {enabled && (
            <span>
              {count} {t.territories}
            </span>
          )}
        </div>
      </Command>
    </div>
  );
}
