import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development Vite serves the UI and forwards API calls to Django.
const backend = process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.VITE_HOST || '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': backend,
      '/admin': backend,
      '/static': backend,
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
