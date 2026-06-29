import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3002,
    proxy: {
      // SSE stream: must come BEFORE the generic /api rule.
      // selfHandleResponse prevents Vite from buffering the stream body,
      // which would break Server-Sent Events (the connection would appear to hang).
      '/api/stream': {
        target: 'http://localhost:8002',
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
        target: 'http://localhost:8002',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:8002',
        changeOrigin: true,
      },
    },
  },
})

