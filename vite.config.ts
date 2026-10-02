import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// keep in sync with src/env.d.ts and .env.example
const REQUIRED = ['VITE_API_URL', 'VITE_MAPBIOMAS_URL', 'VITE_BASEMAP_DARK', 'VITE_BASEMAP_LIGHT', 'VITE_BASEMAP_SATELLITE']

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const missing = REQUIRED.filter((k) => !env[k])
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}. Copy .env.example to .env and fill it in.`)
  return { plugins: [react(), tailwindcss()] }
})
