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
  var requestOverrides = read('background/request-overrides.js');
  assert.match(requestOverrides, /validateHttpsUrl/);
  assert.match(requestOverrides, /url\.protocol !== 'https:'/);
  var queryAi = read('background/query-ai.js');
  assert.match(queryAi, /validateHttpsUrl\(url\)\.toString\(\)/);
});

test('package manifest uses optional host permissions for API hosts', function () {
  var manifest = JSON.parse(read('manifest.json'));
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
  assert.equal(Object.hasOwn(manifest, 'host_permissions'), false);
  assert.deepEqual(manifest.web_accessible_resources[0].resources, ['permission/*']);
});

test('background can request API host permission dynamically', function () {
  var source = read('background/index.js');
  assert.match(source, /request\.action === 'checkApiHostPermission'/);
  assert.match(source, /chrome\.permissions\.contains/);
  assert.doesNotMatch(source, /chrome\.permissions\.request/);
});

test('permission request happens from extension page click handler', function () {
  var source = read('permission/host-permission.js');
  assert.match(source, /authorizeBtn\.addEventListener\('click'/);
  assert.match(source, /chrome\.permissions\.request/);
  assert.match(source, /window\.parent\.postMessage/);
});

test('extension pages do not use inline scripts blocked by MV3 CSP', function () {
  var source = read('permission/host-permission.html');
  assert.doesNotMatch(source, /<script(?![^>]*\bsrc=)[^>]*>/i);
});

test('build copies the permission grant page', function () {
  var source = read('scripts/build.mjs');
  assert.match(source, /copyEntry\(root, dist, 'permission'\)/);
});

test('advanced request overrides replace key value custom fields', function () {
  var background = read('background/index.js');
  var queryAi = read('background/query-ai.js');
  var ui = read('content/ui.js');
  var build = read('scripts/build.mjs');

  assert.match(background, /customHeadersJson/);
  assert.match(background, /customBodyJson/);
  assert.match(queryAi, /applyRequestOverrides/);
  assert.match(ui, /Headers JSON 覆盖/);
  assert.match(ui, /Body JSON 覆盖/);
  assert.match(build, /background\/request-overrides\.js/);
  assert.doesNotMatch(background + queryAi + ui, /customBodyFields/);
}
);

test('custom template API mode is wired through background and UI', function () {
  var background = read('background/index.js');
  var queryAi = read('background/query-ai.js');
  var ui = read('content/ui.js');

  assert.match(queryAi, /mode === 'custom-template'/);
  assert.match(queryAi, /callCustomTemplateAPI/);
  assert.match(background, /templateHeadersJson/);
  assert.match(background, /templateBodyJson/);
  assert.match(background, /templateResponseText/);
  assert.match(ui, /value="custom-template"/);
  assert.match(ui, /Headers 模板/);
  assert.match(ui, /Body 模板/);
  assert.match(ui, /响应模板/);
});

test('AI calls verify host permission before network fetch', function () {
  var source = read('background/query-ai.js');
  assert.match(source, /assertApiHostPermission\(config\.url\)/);
});

test('config form requests API host permission before saving', function () {
  var source = read('content/ui.js');
  assert.match(source, /checkApiHostPermission/);
  assert.match(source, /showApiHostPermissionFrame/);
  assert.match(source, /授权/);
});

test('capture UI opens permission page before screenshot when API host is missing', function () {
  var source = read('content/ui.js');
  assert.match(source, /ensureActiveConfigPermissionBeforeCapture/);
  assert.match(source, /showApiHostPermissionFrame\(perm\.origin\)/);
  assert.match(source, /需要先授权访问/);
});

test('AI answer HTML is sanitized before rendering', function () {
  var source = read('content/ui.js');
  assert.match(source, /sanitizeAnswerHtml/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML=\$\{\{ __html: a\.content \}\}/);
});
