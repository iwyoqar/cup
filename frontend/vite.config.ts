import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Mobile-first Telegram Mini App. No SSR, no router — a single-page state machine
// (see src/app/AppShell.tsx) is enough for this phase's scope.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  // Dev/tooling-only: `vite preview` rejects requests with an unrecognized Host header by
  // default. A Cloudflare Quick Tunnel hostname is random per run, so it can't be allow-listed
  // individually — this only affects how the local preview server accepts a Host header, not
  // any application logic or the backend's own CORS policy.
  preview: {
    allowedHosts: true,
  },
});
