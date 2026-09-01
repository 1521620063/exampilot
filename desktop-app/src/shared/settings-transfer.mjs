// 设置备份归一化（exampilot-settings-backup v1，与扩展共享同一备份格式）：导入时严格校验并钳制全部字段。
import { DEFAULT_SILENT_PROMPT } from '../defaults.mjs';

var VALID_API_MODES = { 'chat-completions': true, 'responses-api': true, anthropic: true, 'custom-template': true };
var CONFIG_STRING_FIELDS = ['model', 'apiKey', 'customHeadersJson', 'customBodyJson', 'templateHeadersJson', 'templateBodyJson', 'templateResponseText'];
function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function requireString(value, label, allowEmpty) { if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw new Error(label + ' must be ' + (allowEmpty ? 'a string' : 'a non-empty string')); return value; }
function cursorSize(value) { var size = Number(value); return Number.isFinite(size) ? Math.max(10, Math.min(Math.round(size), 32)) : 14; }
function silentCursorOffset(value) { var offset = Number(value); return Number.isFinite(offset) ? Math.max(1, Math.min(Math.round(offset), 20)) : 5; }
// 校验并归一化单个配置；id 缺省时生成，重复 id 追加 _copy 去重
function configFromBackup(config, index, usedIds) {
  if (!isPlainObject(config)) throw new Error('Configuration ' + (index + 1) + ' is invalid');
  var id = typeof config.id === 'string' && config.id.trim() ? config.id : 'cfg_import_' + (index + 1);
  while (usedIds[id]) id += '_copy';
  usedIds[id] = true;
  var url = requireString(config.url, 'Configuration URL', false);
  var parsedUrl;
  try { parsedUrl = new URL(url); } catch (_) { throw new Error('Configuration ' + (index + 1) + ' has an invalid URL'); }
  if (parsedUrl.protocol !== 'https:') throw new Error('Configuration ' + (index + 1) + ' must use HTTPS');
  var result = { id: id, name: requireString(config.name, 'Configuration name', false), url: url, apiMode: config.apiMode || 'chat-completions', selected: config.selected === true };
  if (!VALID_API_MODES[result.apiMode]) throw new Error('Configuration ' + (index + 1) + ' has an unsupported API mode');
  CONFIG_STRING_FIELDS.forEach(function (field) { result[field] = config[field] === undefined ? '' : requireString(config[field], field, true); });
  return result;
}

// 校验备份结构（格式标记与版本号），归一化并钳制全部设置字段
export function normalizeSettingsBackup(backup) {
  if (!isPlainObject(backup) || backup.format !== 'exampilot-settings-backup' || backup.version !== 1 || !isPlainObject(backup.settings)) throw new Error('Invalid ExamPilot settings backup');
  var settings = backup.settings;
  if (!Array.isArray(settings.configList) || settings.configList.length > 100) throw new Error('Invalid configuration list');
  var usedIds = {};
  var configList = settings.configList.map(function (config, index) { return configFromBackup(config, index, usedIds); });
  // 只保留第一个选中的配置；全部未选中时默认选第一个
  var selected = false;
  configList.forEach(function (config) { config.selected = config.selected && !selected; selected = selected || config.selected; });
  if (configList.length && !selected) configList[0].selected = true;
  var opacity = Number(settings.uiOpacity);
  if (!Number.isFinite(opacity)) throw new Error('Invalid answer window opacity');
  return { configList: configList, customPrompt: requireString(settings.customPrompt, 'Prompt', true), silentPrompt: settings.silentPrompt === undefined ? DEFAULT_SILENT_PROMPT : requireString(settings.silentPrompt, 'Silent prompt', true), uiOpacity: Math.max(0, Math.min(opacity, 1)), silentModeEnabled: settings.silentModeEnabled === true, silentDebugFrameEnabled: settings.silentDebugFrameEnabled === true, fakeCursorSize: cursorSize(settings.fakeCursorSize), fakeCursorStyle: settings.fakeCursorStyle === 'light-outline' ? 'light-outline' : 'dark-outline', silentCursorOffset: silentCursorOffset(settings.silentCursorOffset) };
}

// 生成备份：打包当前设置并经归一化，保证导出文件始终合法
export function createSettingsBackup(settings) {
  var backup = { format: 'exampilot-settings-backup', version: 1, exportedAt: new Date().toISOString(), settings: settings };
  backup.settings = normalizeSettingsBackup(backup);
  return backup;
}
