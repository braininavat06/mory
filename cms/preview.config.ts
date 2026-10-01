import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), base: '/preview-assets/', publicDir: false, build: { outDir: 'dist/preview', emptyOutDir: true, assetsInlineLimit: 0, rolldownOptions: { input: fileURLToPath(new URL('./client/preview.ts', import.meta.url)), output: { entryFileNames: 'preview.js', assetFileNames: asset => asset.names.some(name => name.endsWith('.css')) ? 'style.css' : 'assets/[name]-[hash][extname]' } } } });
