import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Desktop-first Admin Panel — a separate Vite project from frontend/ (the Telegram Mini App),
// deliberately isolated per Phase 3 Part 3 rather than sharing routes/bundle with the customer
// app. No router library: the scope (Dashboard, Settings > Loyalty, Logout) is small enough for
// plain component-swap state — see src/App.tsx.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  preview: {
    allowedHosts: true,
  },
});
