import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@converter': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
      '@evaluation': fileURLToPath(new URL('../tools/evaluation', import.meta.url)),
    },
    dedupe: ['react', 'react-dom', '@sightread/lilypond-wasm'],
  },
  optimizeDeps: { exclude: ['@sightread/lilypond-wasm'] },
  worker: { format: 'es' },
  build: { target: 'esnext' },
});
