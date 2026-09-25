import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';
import { defineConfig } from 'vite';

// ONE file: dist/bundle.js — an IIFE with its CSS injected, exactly what Poster's POS platform loads ("a single JS file (bundle)"; every resource must be inside it).
// Nothing secret can end up here: the only build-time value read is the PUBLIC API base URL (VITE_CUP_API_URL).
export default defineConfig({
  plugins: [react(), tailwindcss(), cssInjectedByJsPlugin()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    target: 'es2019',
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: { entry: 'src/main.tsx', formats: ['iife'], name: 'CupPosWidget', fileName: () => 'bundle.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
