import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    target: 'esnext',
    outDir: 'dist-browser',
    rollupOptions: { input: 'test/browser/browser.html' },
  },
  worker: { format: 'es' },
});
