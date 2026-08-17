import test from 'node:test';
import assert from 'node:assert/strict';
import { mapTargetsToMonitor, normalizeSilentResult } from '../src/silent.mjs';

test('normalizes percent targets and clipboard-only answers', function () {
  var result = normalizeSilentResult(JSON.stringify({
    items: [
      { questionNumber: '1', answer: 'B', coordinatePercent: { x: 0.4, y: 0.5 }, bboxPercent: { x: 0.3, y: 0.4, width: 0.2, height: 0.2 } },
      { questionNumber: '2', answer: '简答', clipboardOnly: true }
    ]
  }));
  assert.equal(result.targets.length, 1);
  assert.deepEqual(result.targets[0].target, { x: 0.3, y: 0.4, width: 0.2, height: 0.2 });
  assert.equal(result.clipboardText, '2: 简答');
});

test('rejects a point outside its bounding box', function () {
  assert.throws(function () {
    normalizeSilentResult('{"answer":"A","coordinatePercent":{"x":0.9,"y":0.9},"bboxPercent":{"x":0,"y":0,"width":0.2,"height":0.2}}');
  }, /bboxPercent/);
});

test('maps cropped-image targets back to monitor coordinates', function () {
  var targets = mapTargetsToMonitor([{ target: { x: 0.25, y: 0.5, width: 0.5, height: 0.25 } }], {
    monitor: { width: 1920, height: 1080 },
    captureRect: { x: 480, y: 270, width: 960, height: 540 }
  });
  assert.deepEqual(targets[0], { x: 0.375, y: 0.5, width: 0.25, height: 0.125 });
});
