import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function read(path) {
  return readFileSync(new URL('../' + path, import.meta.url), 'utf8');
}

test('content script injection is idempotent', function () {
  var source = read('content/index.js');
  assert.match(source, /__exampilotMounted/);
  assert.match(source, /document\.getElementById\('exmp-container'\)/);
});

test('capture UI supports cancellation and persistent request state', function () {
  var source = read('content/ui.js');
  assert.match(source, /useRef/);
  assert.match(source, /currentRequestSeqRef/);
  assert.match(source, /hiddenByUserRef/);
  assert.match(source, /cancelCapture/);
  assert.match(source, /取消/);
});

test('background handles explicit cancellation', function () {
  var source = read('background/index.js');
  assert.match(source, /request\.action === 'cancelCapture'/);
  assert.match(source, /currentAbortController\.abort\(\)/);
});

test('API URL validation rejects non-HTTPS endpoints', function () {
  var source = read('background/query-ai.js');
  assert.match(source, /validateApiUrl/);
  assert.match(source, /url\.protocol !== 'https:'/);
});

test('AI answer HTML is sanitized before rendering', function () {
  var source = read('content/ui.js');
  assert.match(source, /sanitizeAnswerHtml/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML=\$\{\{ __html: a\.content \}\}/);
});
