// Build-time config from .env (see .env.example); vite.config.ts fails the build if one is missing
interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_MAPBIOMAS_URL: string;
  readonly VITE_BASEMAP_DARK: string;
  readonly VITE_BASEMAP_LIGHT: string;
  readonly VITE_BASEMAP_SATELLITE: string;
}
