import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Barista-facing Staff Panel — a separate Vite project from admin/ (management) and frontend/ (the
// customer Mini App). Its own bundle, its own session token, its own API namespace (/staff/*).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist' },
  server: { port: 5175 },
  preview: { allowedHosts: true },
});
