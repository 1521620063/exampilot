// 应用内更新封装：基于 Tauri updater 插件检查新版本、跟踪下载进度并安装重启（更新包签名校验由插件在安装时完成）。
import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

// 提取更新详情供界面展示
export function updateDetails(update) {
  if (!update) return null;
  return {
    currentVersion: update.currentVersion || '',
    version: update.version || '',
    date: update.date || '',
    body: update.body || ''
  };
}

// 把 updater 的 Started/Progress/Finished 事件累积为进度状态
export function progressState(event, state) {
  var next = Object.assign({ downloaded: 0, total: null, finished: false }, state || {});
  if (event.event === 'Started') {
    next.downloaded = 0;
    next.total = event.data && event.data.contentLength ? event.data.contentLength : null;
  } else if (event.event === 'Progress') {
    next.downloaded += event.data && event.data.chunkLength ? event.data.chunkLength : 0;
  } else if (event.event === 'Finished') {
    next.finished = true;
  }
  return next;
}

export function progressPercent(state) {
  if (!state || !state.total) return null;
  return Math.max(0, Math.min(100, Math.round((state.downloaded / state.total) * 100)));
}

export function formatUpdateError(error) {
  var message = error && error.message ? error.message : String(error || '未知错误');
  return '更新失败：' + message;
}

export async function currentVersion() {
  return getVersion();
}

// 检查更新（10 秒超时）；checkFn 参数便于测试注入
export async function checkForUpdate(checkFn) {
  var updaterCheck = checkFn || check;
  return updaterCheck({ timeout: 10000 });
}

// 下载并安装更新后重启应用；installFn/relaunchFn 参数便于测试注入
export async function downloadAndInstall(update, onProgress, installFn, relaunchFn) {
  var install = installFn || update.downloadAndInstall.bind(update);
  await install(onProgress);
  await (relaunchFn || relaunch)();
}
