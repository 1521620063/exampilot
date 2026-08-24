import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

var root = join(dirname(fileURLToPath(import.meta.url)), '..');
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
    CARGO_HOME: join(root, '.cargo')
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
