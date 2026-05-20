import { execSync } from 'child_process';
import { copyFileSync, mkdirSync, rmSync, readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const dist = join(root, 'dist', 'chrome');

const noMinify = process.env.NO_MINIFY === 'true';

// 1. Clean dist
rmSync(dist, { recursive: true, force: true });

// 2. Build content bundle
const minifyCli = noMinify ? '' : '--minify';
execSync(
  `npx esbuild content/index.js --bundle ${minifyCli} --outfile=dist/chrome/content/bundle/content-bundle.js`,
  { cwd: root, stdio: 'inherit' }
);

// 3. Build background files
execSync(
  `npx esbuild background/index.js background/request-overrides.js background/query-ai.js ${minifyCli} --outdir=dist/chrome/background --outbase=background`,
  { cwd: root, stdio: 'inherit' }
);

// 4. Copy static assets (manifest.json, icons)
function copyEntry(srcRoot, destRoot, name) {
  const src = join(srcRoot, name);
  const dest = join(destRoot, name);
  const s = statSync(src);
  if (s.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const item of readdirSync(src)) {
      copyEntry(src, dest, item);
    }
  } else {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
}

copyEntry(root, dist, 'manifest.json');
copyEntry(root, dist, 'icons');
copyEntry(root, dist, 'permission');

// 上架版（NO_MINIFY）移除 host_permissions，避免审核障碍
if (noMinify) {
  const manifestPath = join(dist, 'manifest.json');
  const content = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  delete content.host_permissions;
  writeFileSync(manifestPath, JSON.stringify(content, null, 2) + '\n', 'utf-8');
}

console.log('\n✅ 打包完成: /dist/chrome');
