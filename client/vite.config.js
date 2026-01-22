import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Backend server runs on 3001 in dev mode
const BACKEND_PORT = process.env.BACKEND_PORT || 3001

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://localhost:${BACKEND_PORT}`,
        ws: true,
        changeOrigin: true,
        // Handle connection errors gracefully
        configure: (proxy) => {
          // Suppress ALL error logs - they are expected during startup and reconnects
          proxy.on('error', () => {
            // Silently ignore all proxy errors
          });
          proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
            socket.on('error', () => {
              // Silently ignore socket errors
            });
          });
        },
      },
      '/assets': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
})
