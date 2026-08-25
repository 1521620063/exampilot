import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export function updateDetails(update) {
  if (!update) return null;
  return {
    currentVersion: update.currentVersion || '',
    version: update.version || '',
    date: update.date || '',
    body: update.body || ''
  };
}

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

export async function checkForUpdate(checkFn) {
  var updaterCheck = checkFn || check;
  return updaterCheck({ timeout: 10000 });
}

export async function downloadAndInstall(update, onProgress, installFn, relaunchFn) {
  var install = installFn || update.downloadAndInstall.bind(update);
  await install(onProgress);
  await (relaunchFn || relaunch)();
}
