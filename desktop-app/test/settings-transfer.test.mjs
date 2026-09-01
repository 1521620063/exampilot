// 测试：设置备份（exampilot-settings-backup v1）的归一化
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettingsBackup } from '../src/shared/settings-transfer.mjs';

function backup(overrides) {
  return { format: 'exampilot-settings-backup', version: 1, settings: Object.assign({ configList: [], customPrompt: '', silentPrompt: '', uiOpacity: 0.95, silentModeEnabled: true, silentDebugFrameEnabled: false }, overrides || {}) };
}

test('imports legacy backups with default cursor preferences', function () {
  var settings = normalizeSettingsBackup(backup());
  assert.equal(settings.fakeCursorSize, 14);
  assert.equal(settings.fakeCursorStyle, 'dark-outline');
  assert.equal(settings.silentCursorOffset, 5);
});

test('clamps imported cursor preferences', function () {
  var settings = normalizeSettingsBackup(backup({ fakeCursorSize: 999, fakeCursorStyle: 'unsupported' }));
  assert.equal(settings.fakeCursorSize, 32);
  assert.equal(settings.fakeCursorStyle, 'dark-outline');
  assert.equal(settings.silentCursorOffset, 5);
});

test('clamps imported silent cursor offset', function () {
  assert.equal(normalizeSettingsBackup(backup({ silentCursorOffset: 0 })).silentCursorOffset, 1);
  assert.equal(normalizeSettingsBackup(backup({ silentCursorOffset: 20.6 })).silentCursorOffset, 20);
});

test('preserves opacity as a 0 to 1 ratio', function () {
  assert.equal(normalizeSettingsBackup(backup({ uiOpacity: 0 })).uiOpacity, 0);
  assert.equal(normalizeSettingsBackup(backup({ uiOpacity: 1.5 })).uiOpacity, 1);
});
