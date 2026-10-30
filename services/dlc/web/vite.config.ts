import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    // In production the python server owns both the page and the API, so the
    // app only ever uses relative URLs. During `pnpm dev` Vite owns the page,
    // so /api is forwarded to the tool server to keep those URLs relative
    // there too - no dev-only base URL anywhere in the source.
    proxy: {
      '/api': 'http://127.0.0.1:8795',
    },
  },
})
