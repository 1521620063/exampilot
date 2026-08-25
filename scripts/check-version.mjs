import fs from 'node:fs';

var expected = process.argv[2] || process.env.GITHUB_REF_NAME;
var packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
var tauri = JSON.parse(fs.readFileSync('desktop-app/src-tauri/tauri.conf.json', 'utf8'));
var cargo = fs.readFileSync('desktop-app/src-tauri/Cargo.toml', 'utf8');
var cargoVersion = (cargo.match(/^version\s*=\s*"([^"]+)"/m) || [])[1];
var versions = { package: packageJson.version, tauri: tauri.version, cargo: cargoVersion };
var unique = Array.from(new Set(Object.values(versions)));
if (unique.length !== 1) {
  console.error('Version mismatch:', versions);
  process.exit(1);
}
if (expected && expected.replace(/^v/, '') !== unique[0]) {
  console.error('Tag/version mismatch:', { tag: expected, version: unique[0] });
  process.exit(1);
}
console.log('Version check passed:', unique[0]);
