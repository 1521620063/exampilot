import test from 'node:test';
import assert from 'node:assert/strict';
import { formatUpdateError, progressPercent, progressState, updateDetails } from '../src/updater.mjs';

test('normalizes update metadata for the settings UI', function () {
  assert.deepEqual(updateDetails({ currentVersion: '1.0.0', version: '1.1.0', date: '2026-08-25', body: 'Fixes' }), {
    currentVersion: '1.0.0', version: '1.1.0', date: '2026-08-25', body: 'Fixes'
  });
  assert.equal(updateDetails(null), null);
});

test('tracks updater download progress', function () {
  var state = progressState({ event: 'Started', data: { contentLength: 1000 } });
  state = progressState({ event: 'Progress', data: { chunkLength: 250 } }, state);
  assert.equal(progressPercent(state), 25);
  state = progressState({ event: 'Finished', data: {} }, state);
  assert.equal(state.finished, true);
});

test('formats update failures without leaking unrelated settings', function () {
  assert.equal(formatUpdateError(new Error('signature mismatch')), '更新失败：signature mismatch');
});
