// Production: /config.js, written by nginx from the server .env when the container starts (nginx.conf).
// Dev: public/config.js is empty, so the values come from .env through Vite.
const runtime = (window as { __CONFIG?: Partial<ImportMetaEnv> }).__CONFIG ?? {};
export const config = { ...import.meta.env, ...runtime } as ImportMetaEnv;
