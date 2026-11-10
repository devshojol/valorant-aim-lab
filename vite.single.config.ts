// Single-bundle build (one JS + one CSS) used to produce a self-contained HTML file
// (scripts/build-single.mjs) that can be hosted anywhere or opened directly.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __SAMPLE_OVERRIDES__: JSON.stringify(false), __LOCAL_MODELS__: JSON.stringify(false) },
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist-single',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 8000,
    rollupOptions: { output: { inlineDynamicImports: true, entryFileNames: 'app.js', assetFileNames: 'app.[ext]' } },
  },
});
