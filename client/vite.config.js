import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_STAMP__: JSON.stringify('2026-03-02-seo-force-redeploy'),
    // Hardcoded production URLs — immune to broken Cloudflare/Vercel env vars
    __PROD_API_URL__: JSON.stringify('https://cryptosite-rud8.onrender.com/api'),
    __PROD_SOCKET_URL__: JSON.stringify('https://cryptosite-rud8.onrender.com'),
  },
})
