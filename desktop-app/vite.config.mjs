// Vite 配置：构建桌面端设置窗口前端（输出到 desktop-app/dist，由 Tauri 加载）
import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

var appRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: appRoot,
  clearScreen: false, // 保留 Tauri 终端输出
  server: {
    port: 1420, // 必须与 tauri.conf.json 的 devUrl 端口一致
    strictPort: true,
    fs: { allow: [resolve(appRoot, '..')] }, // 允许引用仓库根的共享模块
    watch: { ignored: ['**/src-tauri/target/**'] } // 忽略 Rust 构建产物，避免无谓刷新
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    outDir: resolve(appRoot, 'dist'),
    emptyOutDir: true,
    target: ['es2021', 'chrome100', 'safari13'],
    minify: process.env.NO_MINIFY === 'true' ? false : 'esbuild' // NO_MINIFY=true 便于调试产物
  }
});
