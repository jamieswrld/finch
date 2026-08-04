import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves under /finch/ (set by its CI); every other host — Vercel,
// local dev, local builds — serves at the root.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' && process.env.GITHUB_ACTIONS ? '/finch/' : '/',
}))
