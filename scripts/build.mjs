import { execSync } from 'child_process';
import { copyFileSync, mkdirSync, rmSync, readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const noMinify = process.env.NO_MINIFY === 'true';
const buildMode = process.env.BUILD_MODE === 'full' ? 'full' : 'optional';
const fullAccess = buildMode === 'full';
const root = join(fileURLToPath(import.meta.url), '..', '..');
const distDirName = fullAccess ? 'chrome-full' : 'chrome';
const dist = join(root, 'dist', distDirName);

// 1. Clean dist
rmSync(dist, { recursive: true, force: true });

// 2. Build content bundle
const minifyCli = noMinify ? '' : '--minify';
const fullAccessDefine = `--define:__EXAMPILOT_FULL_ACCESS__=${fullAccess ? 'true' : 'false'}`;
execSync(
  `npx esbuild content/index.js --bundle ${minifyCli} ${fullAccessDefine} --outfile=dist/${distDirName}/content/bundle/content-bundle.js`,
  { cwd: root, stdio: 'inherit' }
);

// 3. Build background files
execSync(
  `npx esbuild background/index.js background/template-engine.js background/request-overrides.js background/settings-transfer.js background/query-ai.js ${minifyCli} ${fullAccessDefine} --outdir=dist/${distDirName}/background --outbase=background`,
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

if (fullAccess) {
  const manifestPath = join(dist, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  manifest.name = 'ExamPilot Full Access - 智能解题引擎';
  manifest.permissions = (manifest.permissions || []).filter((permission) => permission !== 'scripting');
  delete manifest.optional_host_permissions;
  delete manifest.web_accessible_resources;
  manifest.content_scripts = [{
    matches: ['<all_urls>'],
    js: ['content/bundle/content-bundle.js'],
    run_at: 'document_idle'
  }];
  manifest.host_permissions = ['<all_urls>'];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

console.log(`\n✅ 打包完成 (${buildMode}): /dist/${distDirName}`);
