// Config keys (see .env.example). Dev reads them from .env; production from /config.js (see src/config.ts)
interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_MAPBIOMAS_URL: string;
  readonly VITE_BASEMAP_DARK: string;
  readonly VITE_BASEMAP_LIGHT: string;
  readonly VITE_BASEMAP_SATELLITE: string;
}
