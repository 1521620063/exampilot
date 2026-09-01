// 测试：自定义 AI 配置的校验规则
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, validateConfigField } from '../src/shared/config-validation.mjs';

var validConfig = {
  name: 'Example',
  url: 'https://api.example.com/v1/chat/completions',
  model: 'example-vision',
  apiMode: 'chat-completions',
  customHeadersJson: '',
  customBodyJson: ''
};

test('accepts a complete built-in AI configuration', function () {
  assert.deepEqual(validateConfig(validConfig), {});
});

test('requires a name, HTTPS URL, and model for built-in modes', function () {
  var errors = validateConfig(Object.assign({}, validConfig, { name: '', url: 'http://api.example.com', model: '' }));
  assert.equal(errors.name, '请填写配置名称');
  assert.equal(errors.url, '接口地址必须使用 HTTPS');
  assert.equal(errors.model, '请填写模型名称');
});

test('allows a custom template without a model and validates JSON overrides', function () {
  assert.equal(validateConfigField(Object.assign({}, validConfig, { apiMode: 'custom-template', model: '' }), 'model'), '');
  assert.equal(validateConfigField(Object.assign({}, validConfig, { customHeadersJson: '[]' }), 'customHeadersJson'), 'Headers JSON 必须是有效的 JSON 对象');
  assert.equal(validateConfigField(Object.assign({}, validConfig, { customBodyJson: '{' }), 'customBodyJson'), 'Body JSON 必须是有效的 JSON 对象');
});
