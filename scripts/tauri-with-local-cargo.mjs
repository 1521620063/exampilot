// Tauri CLI 包装脚本：用仓库本地 .cargo 作为 CARGO_HOME 执行 tauri 构建，并处理 Windows 上 WiX light.exe 写 WixPdb 失败导致的 MSI 打包报错（自动用 -spdb 重链接并补签名，必要时补跑 NSIS 打包）。
import { spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'fs';
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

// 环境变量缺省时回退读取本地签名密钥文件
if (!signingPrivateKey) {
  signingPrivateKey = readLocalSigningValue('updater.key');
}
if (!signingPrivateKeyPassword) {
  signingPrivateKeyPassword = readLocalSigningValue('updater-password');
}

var command = process.execPath;
var cliArgs = process.argv.slice(2);
var args = cliArgs.concat([
  '--config',
  join(root, 'desktop-app', 'src-tauri', 'tauri.conf.json')
]);
args.unshift(join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'));
var childEnvironment = {
  ...process.env,
  CARGO_HOME: join(root, '.cargo'),
  ...(signingPrivateKey ? { TAURI_SIGNING_PRIVATE_KEY: signingPrivateKey } : {}),
  ...(signingPrivateKeyPassword ? { TAURI_SIGNING_PRIVATE_KEY_PASSWORD: signingPrivateKeyPassword } : {})
};

// 启动子进程执行命令；captureOutput 时同时透传并收集输出
function run(executable, commandArgs, environment, workingDirectory, captureOutput) {
  return new Promise(function (resolve, reject) {
    var child = spawn(executable, commandArgs, {
      cwd: workingDirectory || root,
      env: environment,
      stdio: captureOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit'
    });
    var output = '';

    if (captureOutput) {
      child.stdout.on('data', function (chunk) {
        output += chunk.toString();
        process.stdout.write(chunk);
      });
      child.stderr.on('data', function (chunk) {
        output += chunk.toString();
        process.stderr.write(chunk);
      });
    }

    child.on('error', reject);
    child.on('exit', function (code) {
      resolve({
        code: code === null ? 1 : code,
        output: output
      });
    });
  });
}

// 解析命令行 --bundles 参数；未指定时返回 null
function requestedBundles() {
  var index = cliArgs.indexOf('--bundles');
  if (index < 0) {
    return null;
  }

  var bundles = [];
  for (var i = index + 1; i < cliArgs.length && !cliArgs[i].startsWith('-'); i += 1) {
    bundles.push(...cliArgs[i].split(','));
  }
  return bundles;
}

function needsNsisRecovery() {
  var bundles = requestedBundles();
  return bundles === null || bundles.includes('all') || bundles.includes('nsis');
}

// 构造仅打包 NSIS 的补充构建参数（剔除原 --bundles 参数后固定 --bundles nsis）
function nsisArgs() {
  var result = [];
  for (var i = 0; i < cliArgs.length; i += 1) {
    if (cliArgs[i] !== '--bundles') {
      result.push(cliArgs[i]);
      continue;
    }

    i += 1;
    while (i < cliArgs.length && !cliArgs[i].startsWith('-')) {
      i += 1;
    }
    i -= 1;
  }
  result.push('--bundles', 'nsis');
  return [
    join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'),
    ...result,
    '--config',
    join(root, 'desktop-app', 'src-tauri', 'tauri.conf.json')
  ];
}

function buildPath() {
  return cliArgs.includes('--debug') || cliArgs.includes('-d') ? 'debug' : 'release';
}

// WiX light 写 WixPdb 失败（LGHT0001）时的恢复流程：用 -spdb 重新链接生成 MSI，需要时再补签名
function recoverMsi() {
  if (process.platform !== 'win32' || !cliArgs.includes('build')) {
    return Promise.resolve(false);
  }

  var wixDirectory = join(root, 'desktop-app', 'src-tauri', 'target', buildPath(), 'wix', 'x64');
  var wixObject = join(wixDirectory, 'main.wixobj');
  var locale = join(wixDirectory, 'locale.wxl');
  if (!existsSync(wixObject) || !existsSync(locale)) {
    return Promise.resolve(false);
  }
  var wixObjectStat = statSync(wixObject, { throwIfNoEntry: false });
  // 仅处理本次构建新产生的中间文件
  if (!wixObjectStat || wixObjectStat.mtimeMs < buildStartedAt) {
    return Promise.resolve(false);
  }

  var wixToolDirectory = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'tauri', 'WixTools314');
  var outputMsi = join(wixDirectory, 'output.msi');
  var config = JSON.parse(readFileSync(join(root, 'desktop-app', 'src-tauri', 'tauri.conf.json'), 'utf8'));
  var productName = config.productName;
  var version = config.version;
  var finalMsi = join(
    root,
    'desktop-app',
    'src-tauri',
    'target',
    buildPath(),
    'bundle',
    'msi',
    `${productName}_${version}_x64_en-US.msi`
  );

  mkdirSync(dirname(finalMsi), { recursive: true });
  console.warn('WiX light failed while writing its WixPdb; retrying MSI link with -spdb.');
  var lightArgs = [
    join(wixToolDirectory, 'light.exe'),
    '-spdb',
    '-ext', join(wixToolDirectory, 'WixUtilExtension.dll'),
    '-ext', join(wixToolDirectory, 'WixUIExtension.dll'),
    '-o', outputMsi,
    '-cultures:en-us',
    '-loc', locale,
    '*.wixobj'
  ];

  return run(lightArgs[0], lightArgs.slice(1), childEnvironment, wixDirectory).then(function (result) {
    if (result.code !== 0 || !existsSync(outputMsi)) {
      return false;
    }

    rmSync(finalMsi, { force: true });
    renameSync(outputMsi, finalMsi);
    if (!signingPrivateKey) {
      return true;
    }

    var signerArgs = [
      join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'),
      'signer',
      'sign',
      finalMsi
    ];
    return run(command, signerArgs, childEnvironment).then(function (signResult) {
      return signResult.code === 0;
    });
  });
}

// 主流程：执行 tauri 构建；失败且输出匹配 WiX light 错误时尝试恢复 MSI，再按需补跑 NSIS 打包
var buildStartedAt = Date.now();
run(command, args, childEnvironment, root, true)
  .then(function (result) {
    if (result.code === 0) {
      process.exitCode = 0;
      return;
    }

    if (!/LGHT0001|light\.exe/i.test(result.output)) {
      process.exitCode = result.code;
      return;
    }

    var recovered = recoverMsi();
    return recovered.then(function (didRecover) {
      if (!didRecover) {
        process.exitCode = result.code;
        return;
      }

      if (!needsNsisRecovery()) {
        process.exitCode = 0;
        return;
      }

      return run(command, nsisArgs(), childEnvironment).then(function (nsisResult) {
        process.exitCode = nsisResult.code;
      });
    });
  })
  .catch(function (error) {
    console.error(error);
    process.exitCode = 1;
  });
