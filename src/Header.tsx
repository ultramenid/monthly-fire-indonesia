import { useEffect, useState } from 'react';
import { ArrowRight, Code2, EllipsisVertical, Languages, Moon, Search, Sparkles, Sun, X } from 'lucide-react';
import { LANGS, useI18n } from './i18n';
import { Palette } from './Palette';
import { useDismiss, useTheme } from './ui';

const API_DOCS = 'https://fogo-id.geodatin.com/api/docs/';
const MAPBIOMAS = 'https://fire.mapbiomas.id/en';

export function Logo() {
  const [theme] = useTheme();
  return (
    <a className="logo" href="/" aria-label="MapBiomas Indonesia Fire">
      {/* from fire.mapbiomas.id: the on-dark version has white lettering */}
      <img src={theme === 'dark' ? '/logo-dark.png' : '/logo-light.png'} alt="MapBiomas Indonesia Fire" width={129} height={30} />
    </a>
  );
}

/** Header search box: shows the current territory; clicking it opens the Cmd+K palette. */
export function TerritorySearch({ currentName, onPalette }: { currentName: string; onPalette: () => void }) {
  const { t } = useI18n();
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <div className="header-search">
      <button className="search-box" aria-label={t.search} aria-haspopup="dialog" onClick={onPalette}>
        <Search size={16} color="var(--muted)" />
        <span className="search-current" title={currentName || undefined}>
          {currentName || t.search}
        </span>
        <kbd className="kbd hide-mobile">{mac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
    </div>
  );
}

export function Header({ currentName }: { currentName: string }) {
  const { t, lang, setLang } = useI18n();
  const [theme, setTheme] = useTheme();
  const [langOpen, setLangOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [highlights, setHighlights] = useState(false);
  const langRef = useDismiss<HTMLDivElement>(langOpen, () => setLangOpen(false));
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="header">
      <Logo />
      <TerritorySearch currentName={currentName} onPalette={() => setPalette(true)} />
      {palette && <Palette onClose={() => setPalette(false)} />}
      <button className="nav-btn hide-mobile" aria-pressed={highlights} onClick={() => setHighlights((h) => !h)}>
        <Sparkles size={16} /> {t.highlights}
      </button>
      <a className="nav-btn hide-mobile" href={API_DOCS} target="_blank" rel="noreferrer">
        <Code2 size={16} /> {t.api}
      </a>
      <span className="spacer" />
      <a className="nav-btn hide-mobile" href={MAPBIOMAS} target="_blank" rel="noreferrer">
        {t.goTo}
      </a>
      <div style={{ position: 'relative' }} ref={langRef} className="hide-mobile">
        <button className="icon-btn" aria-label={t.language} onClick={() => setLangOpen((o) => !o)}>
          <Languages size={20} />
        </button>
        {langOpen && (
          <div className="pop menu" style={{ right: 0, top: 40 }} role="menu">
            {LANGS.map((l) => (
              <button
                key={l.id}
                className="menu-item"
                role="menuitemradio"
                aria-checked={lang === l.id}
                onClick={() => {
                  setLang(l.id);
                  setLangOpen(false);
                }}
              >
                {l.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        className="icon-btn"
        aria-label={theme === 'dark' ? t.darkTheme : t.lightTheme}
        aria-pressed={theme === 'light'}
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
      </button>
      <button className="icon-btn" aria-label={t.menu} onClick={() => setDrawer(true)}>
        <EllipsisVertical size={20} />
      </button>

      {drawer && (
        <div className="overlay" style={{ placeItems: 'stretch' }} onPointerDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
          <aside className="drawer" role="dialog" aria-label={t.menu}>
            <div className="drawer-head">
              <Logo />
              <button className="icon-btn" aria-label={t.close} onClick={() => setDrawer(false)}>
                <X size={22} />
              </button>
            </div>
            <a className="drawer-link" href={MAPBIOMAS} target="_blank" rel="noreferrer">
              {t.goTo} <ArrowRight size={18} />
            </a>
            <button className="drawer-link" onClick={() => (setHighlights(true), setDrawer(false))}>
              {t.highlights} <ArrowRight size={18} />
            </button>
            <a className="drawer-link" href={API_DOCS} target="_blank" rel="noreferrer">
              {t.api} <ArrowRight size={18} />
            </a>
            <div className="drawer-foot">
              <select aria-label={t.language} value={lang} onChange={(e) => setLang(e.target.value as typeof lang)}>
                {LANGS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </aside>
        </div>
      )}
    </header>
  );
}
