// AI 请求客户端：按配置的接口模式（Chat Completions / Responses API / Anthropic / 自定义模板）构造请求，并从响应中提取答案文本。
import * as templateEngine from './shared/template-engine.mjs';
import * as requestOverrides from './shared/request-overrides.mjs';

Object.assign(globalThis, templateEngine, requestOverrides);

// 从 data URL 中拆出 base64 与 MIME，并提供多种别名字段，兼容不同模板/接口的变量写法
function imageContext(imageUrl) {
  var match = String(imageUrl || '').match(/^data:([^;]+);base64,([\s\S]*)$/);
  return {
    imageUrl: imageUrl,
    imageBase64: match ? match[2] : imageUrl,
    base64Image: match ? match[2] : imageUrl,
    imageMimeType: match ? match[1] : 'image/jpeg',
    mimeType: match ? match[1] : 'image/jpeg'
  };
}

function normalizeHeaders(headers) {
  var result = {};
  Object.keys(headers || {}).forEach(function (key) {
    if (headers[key] !== null && headers[key] !== undefined) result[key] = String(headers[key]);
  });
  return result;
}

// 按接口模式构造请求：自定义模板走模板引擎，其余内置模式支持用户 Headers/Body 覆盖
export function buildRequest(config, imageUrl, prompt) {
  if (!config || !config.url) throw new Error('请先在设置窗口添加并选择 AI 配置');
  globalThis.validateHttpsUrl(config.url);
  var mode = config.apiMode || 'chat-completions';
  var headers;
  var body;
  if (mode === 'custom-template') {
    var context = Object.assign({ model: config.model || '', apiKey: config.apiKey || '', apiKeyBearer: config.apiKey ? 'Bearer ' + config.apiKey : '', prompt: prompt || '' }, imageContext(imageUrl));
    headers = normalizeHeaders(globalThis.renderJsonObjectTemplate(config.templateHeadersJson || globalThis.getDefaultTemplateHeadersJson(), context, 'Headers 模板'));
    body = globalThis.renderJsonTemplate(config.templateBodyJson || globalThis.getDefaultTemplateBodyJson(), context, 'Body 模板');
  } else if (mode === 'anthropic') {
    headers = { 'Content-Type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' };
    body = { model: config.model, max_tokens: 1024, messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageContext(imageUrl).imageBase64 } },
      { type: 'text', text: prompt }
    ] }] };
    var anthropicOverrides = globalThis.applyRequestOverrides(headers, body, config);
    headers = anthropicOverrides.headers; body = anthropicOverrides.body;
  } else if (mode === 'responses-api') {
    headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey };
    body = { model: config.model, input: [{ role: 'user', content: [{ type: 'input_image', image_url: imageUrl }, { type: 'input_text', text: prompt }] }] };
    var responsesOverrides = globalThis.applyRequestOverrides(headers, body, config);
    headers = responsesOverrides.headers; body = responsesOverrides.body;
  } else {
    headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey };
    body = { model: config.model, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: imageUrl } }, { type: 'text', text: prompt }] }] };
    var chatOverrides = globalThis.applyRequestOverrides(headers, body, config);
    headers = chatOverrides.headers; body = chatOverrides.body;
  }
  return { url: config.url, headers: normalizeHeaders(headers), body: body };
}

// 按接口模式从响应 JSON 中取出正文文本
export function extractAnswer(config, response) {
  var mode = config.apiMode || 'chat-completions';
  var content;
  if (mode === 'custom-template') content = globalThis.renderResponseTemplate(config.templateResponseText || globalThis.getDefaultTemplateResponseText(), response, '响应模板');
  else if (mode === 'anthropic') {
    var block = Array.isArray(response.content) && response.content.find(function (item) { return item.type === 'text'; });
    content = block && block.text;
  } else if (mode === 'responses-api') {
    var message = Array.isArray(response.output) && response.output.find(function (item) { return item.type === 'message'; });
    var textBlock = message && Array.isArray(message.content) && message.content.find(function (item) { return item && typeof item.text === 'string'; });
    content = textBlock && textBlock.text;
  } else content = response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content;
  if (!content || !String(content).trim()) throw new Error('AI 返回内容为空');
  return String(content);
}
