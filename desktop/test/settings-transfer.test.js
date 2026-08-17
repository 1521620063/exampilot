import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettingsBackup } from '../src/shared/settings-transfer.js';

function backup(overrides) {
  return { format: 'exampilot-settings-backup', version: 1, settings: Object.assign({ configList: [], customPrompt: '', silentPrompt: '', uiOpacity: 0.95, silentModeEnabled: true, silentDebugFrameEnabled: false }, overrides || {}) };
}

test('imports legacy backups with default cursor preferences', function () {
  var settings = normalizeSettingsBackup(backup());
  assert.equal(settings.fakeCursorSize, 14);
  assert.equal(settings.fakeCursorStyle, 'dark-outline');
});

test('clamps imported cursor preferences', function () {
  var settings = normalizeSettingsBackup(backup({ fakeCursorSize: 999, fakeCursorStyle: 'unsupported' }));
  assert.equal(settings.fakeCursorSize, 32);
  assert.equal(settings.fakeCursorStyle, 'dark-outline');
});

test('preserves opacity as a 0 to 1 ratio', function () {
  assert.equal(normalizeSettingsBackup(backup({ uiOpacity: 0 })).uiOpacity, 0);
  assert.equal(normalizeSettingsBackup(backup({ uiOpacity: 1.5 })).uiOpacity, 1);
});
