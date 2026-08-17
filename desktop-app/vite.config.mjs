import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

var appRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: appRoot,
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    fs: { allow: [resolve(appRoot, '..')] }
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    outDir: resolve(appRoot, 'dist'),
    emptyOutDir: true,
    target: ['es2021', 'chrome100', 'safari13'],
    minify: process.env.NO_MINIFY === 'true' ? false : 'esbuild'
  }
});
