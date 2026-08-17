var test = require('node:test');
var assert = require('node:assert/strict');
var transfer = require('./settings-transfer.js');

function createLegacyBackup(overrides) {
  return {
    format: 'exampilot-settings-backup',
    version: 1,
    settings: Object.assign({
      configList: [],
      customPrompt: '',
      silentPrompt: '',
      uiOpacity: 0.95,
      silentModeEnabled: true,
      silentScrollPixels: 5,
      silentDebugFrameEnabled: false
    }, overrides || {})
  };
}

test('旧版备份导入时补全仿光标默认配置', function () {
  var settings = transfer.normalizeSettingsBackup(createLegacyBackup());
  assert.equal(settings.fakeCursorSize, 14);
  assert.equal(settings.fakeCursorStyle, 'dark-outline');
  assert.equal(settings.silentCursorOffset, 5);
  assert.equal(Object.prototype.hasOwnProperty.call(settings, 'silentScrollPixels'), false);
});

test('仿光标配置会限制到支持的范围和样式', function () {
  var settings = transfer.normalizeSettingsBackup(createLegacyBackup({
    fakeCursorSize: 999,
    fakeCursorStyle: 'unsupported'
  }));
  assert.equal(settings.fakeCursorSize, 32);
  assert.equal(settings.fakeCursorStyle, 'dark-outline');
  assert.equal(settings.silentCursorOffset, 5);

  settings = transfer.normalizeSettingsBackup(createLegacyBackup({
    fakeCursorSize: 10,
    fakeCursorStyle: 'light-outline'
  }));
  assert.equal(settings.fakeCursorSize, 10);
  assert.equal(settings.fakeCursorStyle, 'light-outline');

  settings = transfer.normalizeSettingsBackup(createLegacyBackup({
    silentCursorOffset: 999
  }));
  assert.equal(settings.silentCursorOffset, 20);

  settings = transfer.normalizeSettingsBackup(createLegacyBackup({
    silentCursorOffset: 0
  }));
  assert.equal(settings.silentCursorOffset, 1);
});
