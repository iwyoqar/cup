import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Desktop-first Admin Panel — a separate Vite project from frontend/ (the Telegram Mini App),
// deliberately isolated per Phase 3 Part 3 rather than sharing routes/bundle with the customer
// app. No router library: the scope (Dashboard, Settings > Loyalty, Logout) is small enough for
// plain component-swap state — see src/App.tsx.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
  },
  // Dev/tooling-only: both `vite dev` and `vite preview` reject requests with an unrecognized
  // Host header by default. A Cloudflare Quick Tunnel hostname is random per run, so it can't be
  // allow-listed individually — this only affects how the local dev/preview server accepts a
  // Host header, not any application logic or the backend's own CORS policy.
  server: {
    allowedHosts: true,
  },
  preview: {
    allowedHosts: true,
  },
});
