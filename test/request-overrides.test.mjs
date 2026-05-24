import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const templateEngine = require('../background/template-engine.js');
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

test('renderJsonTemplate replaces placeholders after JSON parsing', function () {
  var rendered = templateEngine.renderJsonTemplate(
    '{ "model": "{{model}}", "messages": [{ "text": "{{prompt}}", "image": "{{imageUrl}}" }] }',
    {
      model: 'vision-model',
      prompt: '题干里有 "引号" 和换行\n也应该安全',
      imageUrl: 'data:image/jpeg;base64,abc123'
    },
    'Body 模板'
  );

  assert.deepEqual(rendered, {
    model: 'vision-model',
    messages: [{
      text: '题干里有 "引号" 和换行\n也应该安全',
      image: 'data:image/jpeg;base64,abc123'
    }]
  });
});

test('renderJsonTemplate preserves non-string values for exact placeholders', function () {
  var rendered = templateEngine.renderJsonTemplate(
    '{ "max_tokens": "{{limits.maxTokens}}", "metadata": "{{metadata}}" }',
    {
      limits: { maxTokens: 4096 },
      metadata: { source: 'exampilot', tags: ['custom'] }
    },
    'Body 模板'
  );

  assert.deepEqual(rendered, {
    max_tokens: 4096,
    metadata: { source: 'exampilot', tags: ['custom'] }
  });
});

test('renderJsonObjectTemplate requires a JSON object', function () {
  assert.throws(
    function () { templateEngine.renderJsonObjectTemplate('[]', {}, 'Headers 模板'); },
    /Headers 模板 必须是 JSON 对象/
  );
});

test('renderResponseTemplate extracts nested response values', function () {
  var content = templateEngine.renderResponseTemplate(
    '{{choices[0].message.content}}',
    {
      choices: [{ message: { content: '答案是 42' } }]
    },
    '响应模板'
  );

  assert.equal(content, '答案是 42');
});

test('renderResponseTemplate supports formatted output and reports missing paths', function () {
  var content = templateEngine.renderResponseTemplate(
    '答案：{{output[0].content[0].text}}',
    {
      output: [{ content: [{ text: 'A' }] }]
    },
    '响应模板'
  );

  assert.equal(content, '答案：A');
  assert.throws(
    function () { templateEngine.renderResponseTemplate('{{missing.value}}', {}, '响应模板'); },
    /响应模板 变量不存在: missing\.value/
  );
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
