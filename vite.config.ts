import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Production base matches the GitHub Pages project path: https://<user>.github.io/finch/
// Dev stays at / so localhost works normally. Override with VITE_BASE for other hosts.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? (process.env.VITE_BASE ?? '/finch/') : '/',
}))
