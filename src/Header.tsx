import { useEffect, useState } from 'react';
import { ArrowRight, Code2, EllipsisVertical, Languages, Moon, Search, Sun, X } from 'lucide-react';
import { API } from './api';
import { config } from './config';
import { LANGS, useI18n } from './i18n';
import { Palette } from './Palette';
import { useDismiss, useTheme } from './hooks';
import { Overlay } from './ui';

const API_DOCS_URL = `${API}/docs/`;
const MAPBIOMAS_URL = config.VITE_MAPBIOMAS_URL;

const navButton = 'inline-flex h-8 items-center gap-2 rounded-lg px-3 font-bold text-accent-text no-underline hover:bg-chip';
const drawerLink = 'flex w-full items-center justify-between px-4 py-2.5 text-left text-base font-bold text-fg-2 no-underline';

function Logo() {
  const [theme] = useTheme();
  return (
    <a className="flex shrink-0 items-center gap-2 no-underline" href="/" aria-label="MapBiomas Indonesia Fire">
      <img
        className="mobile:h-[30px] mobile:w-9 mobile:object-cover mobile:object-left"
        src={theme === 'dark' ? '/logo-dark.png' : '/logo-light.png'}
        alt="MapBiomas Indonesia Fire"
        width={129}
        height={30}
      />
    </a>
  );
}

/** Search trigger; clicking it opens the Cmd+K search palette. */
function TerritorySearch({ onOpen }: { onOpen: () => void }) {
  const { labels } = useI18n();
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <div className="relative min-w-[200px] flex-[0_1_380px] mobile:min-w-0 mobile:flex-1">
      <button
        className="flex h-8 w-full items-center gap-1.5 rounded-full border bg-bg px-3 text-left text-fg"
        aria-label={labels.search}
        aria-haspopup="dialog"
        onClick={onOpen}
      >
        <Search size={16} className="text-muted" />
        <span className="min-w-0 flex-1 truncate text-muted">{labels.paletteHint}</span>
        <kbd className="rounded border px-1.5 py-px font-sans text-[11px] leading-4 font-semibold whitespace-nowrap text-muted mobile:hidden">
          {isMac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </button>
    </div>
  );
}

export function Header() {
  const { labels, lang, setLang } = useI18n();
  const [theme, setTheme] = useTheme();
  const [isLangMenuOpen, setLangMenuOpen] = useState(false);
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const [isPaletteOpen, setPaletteOpen] = useState(false);
  const langMenuRef = useDismiss<HTMLDivElement>(isLangMenuOpen, () => setLangMenuOpen(false));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <header className="relative z-20 flex items-center gap-4 bg-surface px-4 mobile:gap-1 mobile:px-2">
      <Logo />
      <TerritorySearch onOpen={() => setPaletteOpen(true)} />
      {isPaletteOpen && <Palette onClose={() => setPaletteOpen(false)} />}
      <a className={`${navButton} mobile:hidden`} href={API_DOCS_URL} target="_blank" rel="noreferrer">
        <Code2 size={16} /> {labels.api}
      </a>
      <span className="flex-1" />
      <a className={`${navButton} mobile:hidden`} href={MAPBIOMAS_URL} target="_blank" rel="noreferrer">
        {labels.goTo}
      </a>
      <div className="relative mobile:hidden" ref={langMenuRef}>
        <button className="icon-btn" aria-label={labels.language} onClick={() => setLangMenuOpen((open) => !open)}>
          <Languages size={20} />
        </button>
        {isLangMenuOpen && (
          <div className="pop top-10 right-0 max-h-[360px] min-w-40 overflow-auto" role="menu">
            {LANGS.map((option) => (
              <button
                key={option.id}
                className="menu-item"
                role="menuitemradio"
                aria-checked={lang === option.id}
                onClick={() => {
                  setLang(option.id);
                  setLangMenuOpen(false);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        className="icon-btn"
        aria-label={theme === 'dark' ? labels.darkTheme : labels.lightTheme}
        aria-pressed={theme === 'light'}
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
      </button>
      <button className="icon-btn" aria-label={labels.menu} onClick={() => setDrawerOpen(true)}>
        <EllipsisVertical size={20} />
      </button>

      {isDrawerOpen && (
        <Overlay onClose={() => setDrawerOpen(false)} className="place-items-stretch">
          <aside className="fixed inset-y-0 right-0 z-60 flex w-[min(314px,100vw)] flex-col bg-bg shadow-pop" role="dialog" aria-label={labels.menu}>
            <div className="flex items-center justify-between border-b py-1 pr-2 pl-4">
              <Logo />
              <button className="icon-btn" aria-label={labels.close} onClick={() => setDrawerOpen(false)}>
                <X size={22} />
              </button>
            </div>
            <a className={drawerLink} href={MAPBIOMAS_URL} target="_blank" rel="noreferrer">
              {labels.goTo} <ArrowRight size={18} />
            </a>
            <a className={drawerLink} href={API_DOCS_URL} target="_blank" rel="noreferrer">
              {labels.api} <ArrowRight size={18} />
            </a>
            <div className="mt-auto p-4">
              <select
                className="h-9 w-full rounded-lg border bg-bg px-2"
                aria-label={labels.language}
                value={lang}
                onChange={(event) => setLang(event.target.value as typeof lang)}
              >
                {LANGS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </aside>
        </Overlay>
      )}
    </header>
  );
}
