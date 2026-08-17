import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, extractAnswer } from '../src/ai-client.mjs';

var base = { url: 'https://api.example.com/v1/chat/completions', model: 'vision', apiKey: 'key', apiMode: 'chat-completions', customHeadersJson: '', customBodyJson: '' };

test('builds OpenAI-compatible requests with overrides', function () {
  var request = buildRequest(Object.assign({}, base, { customBodyJson: '{"temperature":0}' }), 'data:image/jpeg;base64,AAAA', 'solve');
  assert.equal(request.headers.Authorization, 'Bearer key');
  assert.equal(request.body.model, 'vision');
  assert.equal(request.body.temperature, 0);
});

test('extracts built-in provider response structures', function () {
  assert.equal(extractAnswer(base, { choices: [{ message: { content: 'chat' } }] }), 'chat');
  assert.equal(extractAnswer(Object.assign({}, base, { apiMode: 'responses-api' }), { output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'refusal' }, { type: 'output_text', text: 'response' }] }] }), 'response');
  assert.equal(extractAnswer(Object.assign({}, base, { apiMode: 'anthropic' }), { content: [{ type: 'thinking' }, { type: 'text', text: 'anthropic' }] }), 'anthropic');
});

test('uses a custom response template', function () {
  var config = Object.assign({}, base, { apiMode: 'custom-template', templateResponseText: '{{result.answer}}' });
  assert.equal(extractAnswer(config, { result: { answer: 'custom' } }), 'custom');
});
