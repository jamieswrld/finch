import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base matches the GitHub Pages project path: https://<user>.github.io/finch/
// Override with VITE_BASE=/ for root-domain hosting.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? '/finch/',
})
