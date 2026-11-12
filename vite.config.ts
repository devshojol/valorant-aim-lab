import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __SAMPLE_OVERRIDES__: JSON.stringify(true), __LOCAL_MODELS__: JSON.stringify(true) },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        // Babylon is left to the bundler: it lands in chunks only the lazily loaded game page needs,
        // so the menus never download it. (A manual 'babylon' chunk also swallowed Vite's
        // dynamic-import helper, which made the menus preload all of Babylon.)
        manualChunks(id) {
          if (id.includes('node_modules') && !id.includes('@babylonjs')) return 'vendor';
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as any);
