import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const overrides = require('../background/request-overrides.js');

test('mergeJsonOverride recursively merges objects and replaces arrays', function () {
  var base = {
    model: 'gpt-4o',
    metadata: { source: 'exampilot', tags: ['old'] },
    messages: [{ role: 'user', content: ['default'] }]
  };
  var override = {
    metadata: { tags: ['new'], trace: true },
    messages: [{ role: 'system', content: ['custom'] }],
    temperature: 0
  };

  var merged = overrides.mergeJsonOverride(base, override);

  assert.deepEqual(merged, {
    model: 'gpt-4o',
    metadata: { source: 'exampilot', tags: ['new'], trace: true },
    messages: [{ role: 'system', content: ['custom'] }],
    temperature: 0
  });
  assert.deepEqual(base.messages, [{ role: 'user', content: ['default'] }]);
});

test('mergeJsonOverride removes fields when override value is null', function () {
  var merged = overrides.mergeJsonOverride(
    { model: 'gpt-4o', temperature: 1, nested: { keep: true, drop: true } },
    { temperature: null, nested: { drop: null } }
  );

  assert.deepEqual(merged, { model: 'gpt-4o', nested: { keep: true } });
});

test('parseJsonObjectOverride accepts blank input and rejects invalid JSON', function () {
  assert.deepEqual(overrides.parseJsonObjectOverride('', 'Body JSON'), {});
  assert.deepEqual(overrides.parseJsonObjectOverride('   ', 'Headers JSON'), {});
  assert.throws(
    function () { overrides.parseJsonObjectOverride('{bad', 'Body JSON'); },
    /Body JSON 不是有效的 JSON/
  );
});

test('parseJsonObjectOverride requires a JSON object', function () {
  assert.throws(
    function () { overrides.parseJsonObjectOverride('[]', 'Body JSON'); },
    /Body JSON 必须是 JSON 对象/
  );
  assert.throws(
    function () { overrides.parseJsonObjectOverride('"x"', 'Headers JSON'); },
    /Headers JSON 必须是 JSON 对象/
  );
});
