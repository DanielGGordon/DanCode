import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const backendPort = process.env.VITE_BACKEND_PORT || 3000

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    css: false,
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts: ['danpi.tailce0a45.ts.net'],
    proxy: {
      '/socket.io': {
        target: `http://localhost:${backendPort}`,
        ws: true,
      },
      '/api': {
        target: `http://localhost:${backendPort}`,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})
