import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_API_URL: set in .env.local for production/staging (e.g. https://alphaflow.onrender.com)
// Falls back to localhost:8002 for local development
const API_URL = process.env.VITE_API_URL ?? 'http://localhost:8002'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3002,
    proxy: {
      // SSE stream: must come BEFORE the generic /api rule.
      // selfHandleResponse prevents Vite from buffering the stream body,
      // which would break Server-Sent Events (the connection would appear to hang).
      '/api/stream': {
        target: API_URL,
        changeOrigin: true,
        selfHandleResponse: false,
        configure: (proxy) => {
          // Disable proxy-level compression so SSE frames aren't held in a buffer
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('accept-encoding')
          })
        },
      },
      '/api': {
        target: API_URL,
        changeOrigin: true,
      },
      '/health': {
        target: API_URL,
        changeOrigin: true,
      },
    },
  },
})

