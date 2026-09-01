// 前端设置与系统能力的 API 层：设置经 Tauri store 插件持久化，截屏/网络/剪贴板/窗口等能力经 invoke 调用 Rust 侧命令。
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import { open, save } from '@tauri-apps/plugin-dialog';
import { createDefaultSettings } from './defaults.mjs';

// 单例缓存 store 句柄，避免重复加载
var storePromise = null;
var pendingSettings = null;
var settingsFlushPromise = null;

async function getStore() {
  if (!storePromise) storePromise = load('exampilot-settings.json', { autoSave: true });
  return storePromise;
}

export async function loadSettings() {
  var store = await getStore();
  return Object.assign(createDefaultSettings(), (await store.get('settings')) || {});
}

// 合并并发保存：只保留最新待写值，循环刷盘直到队列清空
export async function saveSettings(settings) {
  pendingSettings = JSON.parse(JSON.stringify(settings));
  if (!settingsFlushPromise) {
    settingsFlushPromise = (async function () {
      var store = await getStore();
      while (pendingSettings) {
        var next = pendingSettings;
        pendingSettings = null;
        await store.set('settings', next);
        await store.save();
      }
    })().finally(function () { settingsFlushPromise = null; });
  }
  await settingsFlushPromise;
  return settings;
}

export async function loadLastModelResponse() {
  var store = await getStore();
  return (await store.get('lastModelResponse')) || null;
}

export async function saveLastModelResponse(response) {
  var store = await getStore();
  if (response) await store.set('lastModelResponse', JSON.parse(JSON.stringify(response)));
  else await store.delete('lastModelResponse');
  await store.save();
  return response;
}

// 设置导入/导出：弹系统文件对话框选路径，实际文件读写经 Tauri 命令完成
export async function importSettings() {
  var path = await open({ multiple: false, filters: [{ name: 'ExamPilot 设置', extensions: ['json'] }] });
  if (!path) return null;
  return invoke('read_settings_backup', { path: path });
}

export async function exportSettings(settings) {
  var path = await save({ defaultPath: 'exampilot-settings.json', filters: [{ name: 'ExamPilot 设置', extensions: ['json'] }] });
  if (!path) return false;
  await invoke('write_settings_backup', { path: path, settings: settings });
  return true;
}

export function captureCurrentMonitor() { return invoke('capture_current_monitor'); }
export function captureRegion(rect) { return invoke('capture_region', { rect: rect }); }
export function postJson(request) { return invoke('post_json', { request: request }); }
export function cancelRequest() { return invoke('cancel_request'); }
export function copyText(text) { return invoke('copy_text', { text: text }); }
export function mouseLocation() { return invoke('mouse_location'); }
export function jitterMouse(point) { return invoke('jitter_mouse', { point: point }); }
export function setOverlayTargets(targets, monitor, debug) {
  return invoke('set_overlay_targets', { targets: targets, monitor: monitor, debug: debug });
}
export function setOverlayDebug(debug) { return invoke('set_overlay_debug', { debug: debug }); }
// 应用静默模式窗口配置；光标偏移在此钳制到 1~20，非法值回退 5
export function applySilentSettings(silentModeEnabled, silentDebugFrameEnabled, silentCursorOffset) {
  var offset = Number(silentCursorOffset);
  offset = Number.isFinite(offset) ? Math.max(1, Math.min(Math.round(offset), 20)) : 5;
  return invoke('apply_silent_settings', { silentModeEnabled: silentModeEnabled, silentDebugFrameEnabled: silentDebugFrameEnabled, silentCursorOffset: offset });
}
export function getOverlayState() { return invoke('get_overlay_state'); }
export function getShortcutErrors() { return invoke('get_shortcut_errors'); }
export function clearOverlayTargets() { return invoke('clear_overlay_targets'); }
export function beginRegionSelection() { return invoke('begin_region_selection'); }
export function overlayReady() { return invoke('overlay_ready'); }
export function finishRegionSelection() { return invoke('finish_region_selection'); }
export function hideCaptureUi() { return invoke('hide_capture_ui'); }
export function showAnswerWindow() { return invoke('show_answer_window'); }
export function hideAnswerWindow() { return invoke('hide_answer_window'); }
export function setAnswerOpacity(opacity) { return invoke('set_answer_opacity', { opacity: opacity }); }
