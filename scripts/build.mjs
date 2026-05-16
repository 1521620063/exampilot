import { execSync } from 'child_process';
import { copyFileSync, mkdirSync, rmSync, readdirSync, statSync } from 'fs';
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
  `npx esbuild background/index.js background/query-ai.js ${minifyCli} --outdir=dist/chrome/background --outbase=background`,
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

console.log('\n✅ 打包完成: /dist/chrome');
