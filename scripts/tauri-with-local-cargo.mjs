import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

var root = join(dirname(fileURLToPath(import.meta.url)), '..');
var signingKeyDir = join(homedir(), '.config', 'exampilot');
var signingPrivateKey = process.env.TAURI_SIGNING_PRIVATE_KEY;
var signingPrivateKeyPassword = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;

function readLocalSigningValue(filename) {
  try {
    return readFileSync(join(signingKeyDir, filename), 'utf8').trim();
  } catch (_) {
    return '';
  }
}

if (!signingPrivateKey) {
  signingPrivateKey = readLocalSigningValue('updater.key');
}
if (!signingPrivateKeyPassword) {
  signingPrivateKeyPassword = readLocalSigningValue('updater-password');
}

var command = process.execPath;
var args = process.argv.slice(2).concat([
  '--config',
  join(root, 'desktop-app', 'src-tauri', 'tauri.conf.json')
]);
args.unshift(join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'));
var child = spawn(command, args, {
  cwd: root,
  env: {
    ...process.env,
    CARGO_HOME: join(root, '.cargo'),
    ...(signingPrivateKey ? { TAURI_SIGNING_PRIVATE_KEY: signingPrivateKey } : {}),
    ...(signingPrivateKeyPassword ? { TAURI_SIGNING_PRIVATE_KEY_PASSWORD: signingPrivateKeyPassword } : {})
  },
  stdio: 'inherit'
});

child.on('error', function (error) {
  console.error(error);
  process.exitCode = 1;
});

child.on('exit', function (code) {
  process.exitCode = code === null ? 1 : code;
});
