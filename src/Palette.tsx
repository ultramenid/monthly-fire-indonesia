import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { CornerDownLeft, MapPin, Search, X } from 'lucide-react';
import { useSearch, useTypeNames, type Territory } from './api';
import { useI18n } from './i18n';
import { selectTerritory } from './state';
import { Overlay } from './ui';

// Admin levels always get a filter chip (even with 0 results) so the hierarchy stays visible.
const ADMIN_LEVELS = ['province', 'regency', 'district', 'village'];
// Short searches can return ~9k rows; rendering all of them freezes the page.
const MAX_ROWS_PER_GROUP = 50;
const MAX_ROWS_SINGLE_GROUP = 200;

/** Cmd+K territory search: results grouped by type, with a chip per type to filter. */
export function Palette({ onClose }: { onClose: () => void }) {
  const { labels, name } = useI18n();
  const [input, setInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [onlyType, setOnlyType] = useState<string | null>(null);
  const { data: typeNames = [] } = useTypeNames();

  // wait for a pause in typing before searching
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(input), 250);
    return () => clearTimeout(timer);
  }, [input]);

  const canSearch = input.trim().length > 1;
  const { data = [], isFetching } = useSearch(searchTerm);
  const results = canSearch ? data : [];
  const isLoading = canSearch && (isFetching || input !== searchTerm);

  // the API lists types in hierarchy order: country → region → … → thematic layers
  const typeOrder = typeNames.map((item) => item.type);
  const resultsByType = new Map<string, Territory[]>();
  for (const result of [...results].sort((first, second) => typeOrder.indexOf(first.type) - typeOrder.indexOf(second.type))) {
    const group = resultsByType.get(result.type);
    if (group) group.push(result);
    else resultsByType.set(result.type, [result]);
  }
  const chipTypes = typeOrder.filter((type) => ADMIN_LEVELS.includes(type) || resultsByType.has(type));
  const typeLabel = (type: string) => name(typeNames.find((item) => item.type === type)) || type;
  const visibleGroups = onlyType ? [[onlyType, resultsByType.get(onlyType) ?? []] as const] : [...resultsByType];
  const visibleCount = visibleGroups.reduce((total, [, rows]) => total + rows.length, 0);
  const maxRows = onlyType ? MAX_ROWS_SINGLE_GROUP : MAX_ROWS_PER_GROUP;

  const open = (territory: Territory) => {
    selectTerritory(territory.type, territory.code);
    onClose();
  };

  const chip = (label: string, count: number, type: string | null) => (
    <button
      key={label}
      className="group inline-flex flex-none items-center gap-2 rounded-full border bg-bg px-3.5 py-1.5 text-[13px] font-semibold text-fg aria-pressed:border-primary aria-pressed:bg-primary/14 aria-pressed:text-accent-text"
      aria-pressed={onlyType === type}
      onMouseDown={(event) => event.preventDefault()} // keep focus in the search input
      onClick={() => setOnlyType(type)}
    >
      {label}
      <span className="min-w-[22px] rounded-full bg-surface-2 px-1.5 text-center text-xs text-fg-2 group-aria-pressed:bg-primary/22 group-aria-pressed:text-accent-text">
        {count}
      </span>
    </button>
  );

  return (
    <Overlay onClose={onClose} className="items-start justify-items-center px-4 pt-[10vh] pb-4 backdrop-blur-sm">
      <Command
        key={onlyType ?? ''} // remount when the filter changes so the first row is selected again
        className="flex max-h-[80vh] w-[min(720px,100%)] flex-col overflow-hidden rounded-2xl border bg-bg shadow-[0_24px_64px_rgba(0,0,0,0.45)]"
        shouldFilter={false}
        loop
        label={labels.search}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <div className="relative flex flex-none items-center gap-3 border-b py-3.5 pr-4 pl-5 text-muted">
          <Search size={20} />
          <Command.Input
            className="min-w-0 flex-1 bg-transparent text-[17px] text-fg outline-0 placeholder:text-muted"
            autoFocus
            value={input}
            onValueChange={(value) => {
              setInput(value);
              setOnlyType(null);
            }}
            placeholder={labels.paletteHint}
          />
          <button className="icon-btn" aria-label={labels.close} onClick={onClose}>
            <X size={20} />
          </button>
          {isLoading && <div className="loader-bar top-auto -bottom-px" />}
        </div>

        {canSearch && (
          <div className="flex flex-none flex-wrap gap-2 border-b bg-surface px-5 py-3">
            {chip(labels.allGroups, results.length, null)}
            {chipTypes.map((type) => chip(typeLabel(type), resultsByType.get(type)?.length ?? 0, type))}
          </div>
        )}

        <Command.List className={`palette-list flex-1 overflow-y-auto overscroll-contain ${isLoading && visibleCount ? 'opacity-45 transition-opacity' : ''}`}>
          {!canSearch && <div className="px-5 py-7 text-center text-muted">{labels.typeToSearch}</div>}
          {isLoading && !visibleCount && <Command.Loading className="px-5 py-7 text-center text-muted">{labels.searching}</Command.Loading>}
          {canSearch && !isLoading && visibleCount === 0 && <div className="px-5 py-7 text-center text-muted">{labels.noResults}</div>}
          {visibleGroups.map(([type, rows]) =>
            rows.length ? (
              <Command.Group key={type} heading={`${typeLabel(type)} · ${rows.length}`}>
                {rows.slice(0, maxRows).map((territory) => (
                  <Command.Item
                    key={`${territory.type}:${territory.code}`}
                    value={`${territory.type}:${territory.code}`}
                    onSelect={() => open(territory)}
                    className="group flex cursor-pointer items-center gap-3.5 px-5 py-3 text-[15px] text-fg data-[selected=true]:bg-primary/12"
                  >
                    <MapPin size={18} className="flex-none text-muted group-data-[selected=true]:text-accent-icon" />
                    <span className="truncate">{territory.name}</span>
                    {territory.parentLabel && <small className="text-xs text-muted">{territory.parentLabel}</small>}
                    <CornerDownLeft size={16} className="invisible ml-auto flex-none text-accent-icon group-data-[selected=true]:visible" />
                  </Command.Item>
                ))}
                {rows.length > maxRows && (
                  <div className="pt-2 pr-5 pb-3 pl-[52px] text-[13px] text-muted">
                    +{rows.length - maxRows} · {labels.refineSearch}
                  </div>
                )}
              </Command.Group>
            ) : null,
          )}
        </Command.List>

        <div className="flex flex-none justify-between gap-3 border-t bg-surface px-5 py-2.5 text-xs text-muted">
          <span className="mobile:hidden">{labels.paletteKeys}</span>
          {canSearch && (
            <span>
              {visibleCount} {labels.territories}
            </span>
          )}
        </div>
      </Command>
    </Overlay>
  );
}
