/**
 * 调用视觉大模型识别图片中的题目并求解
 *
 * 支持多种 API 模式（通过 config.apiMode 切换）：
 *   - chat-completions: OpenAI 兼容的 /v1/chat/completions 接口
 *   - responses-api: OpenAI Responses API (/v1/responses)
 *   - anthropic: Anthropic Messages API (/v1/messages)
 *
 * @param {string} imageUrl - 图片 URL（HTTP 地址或 data:image/... base64 均可）
 * @param {string} prompt - 系统提示词（来自用户配置）
 * @returns {Promise<string>} 模型返回的格式化解题内容（含 HTML 标记）
 */
async function queryAI(imageUrl, prompt) {
  const config = await getActiveConfig();
  const mode = config.apiMode || 'chat-completions';

  if (mode === 'responses-api') {
    return callResponsesAPI(config, imageUrl, prompt);
  }
  if (mode === 'anthropic') {
    return callAnthropicAPI(config, imageUrl, prompt);
  }
  return callChatCompletions(config, imageUrl, prompt);
}

/**
 * OpenAI 兼容的 Chat Completions 调用
 * POST /v1/chat/completions
 */
async function callChatCompletions(config, imageUrl, prompt) {
  var headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + config.apiKey
  };
  // Merge custom headers
  (config.customHeaders || []).forEach(function (h) {
    if (h.key) headers[h.key] = h.value;
  });

  var body = {
    model: config.model,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageUrl } },
        { type: 'text', text: prompt }
      ]
    }]
  };
  // Merge custom body fields
  (config.customBodyFields || []).forEach(function (f) {
    if (f.key) body[f.key] = f.value;
  });

  const resp = await fetch(config.url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    throw new Error('API调用失败 (' + resp.status + ')');
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('AI返回内容为空');
  }
  return content;
}

/**
 * OpenAI Responses API 调用
 * POST /v1/responses
 */
async function callResponsesAPI(config, imageUrl, prompt) {
  var headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + config.apiKey
  };
  (config.customHeaders || []).forEach(function (h) {
    if (h.key) headers[h.key] = h.value;
  });

  var body = {
    model: config.model,
    input: [{
      role: 'user',
      content: [
        { type: 'input_image', image_url: imageUrl },
        { type: 'input_text', text: prompt }
      ]
    }]
  };
  (config.customBodyFields || []).forEach(function (f) {
    if (f.key) body[f.key] = f.value;
  });

  const resp = await fetch(config.url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    throw new Error('API调用失败 (' + resp.status + ')');
  }

  const data = await resp.json();
  const messageOutput = data?.output?.find(function (item) { return item.type === 'message'; });
  const content = messageOutput?.content?.[0]?.text;
  if (!content) {
    throw new Error('AI返回内容为空');
  }
  return content;
}

/**
 * Anthropic Messages API 调用
 * POST /v1/messages
 */
async function callAnthropicAPI(config, imageUrl, prompt) {
  const base64Data = imageUrl.replace(/^data:image\/jpeg;base64,/, '');

  var headers = {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey
  };
  (config.customHeaders || []).forEach(function (h) {
    if (h.key) headers[h.key] = h.value;
  });

  var body = {
    model: config.model,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Data } },
        { type: 'text', text: prompt }
      ]
    }]
  };
  (config.customBodyFields || []).forEach(function (f) {
    if (f.key) body[f.key] = f.value;
  });

  const resp = await fetch(config.url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    throw new Error('API调用失败 (' + resp.status + ')');
  }

  const data = await resp.json();
  const textBlock = data?.content?.find(function (item) { return item.type === 'text'; });
  const content = textBlock?.text;
  if (!content) {
    throw new Error('AI返回内容为空');
  }
  return content;
}
