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
async function queryAI(imageUrl, prompt, signal) {
  const config = await getActiveConfig();
  const mode = config.apiMode || 'chat-completions';

  if (mode === 'responses-api') {
    return callResponsesAPI(config, imageUrl, prompt, signal);
  }
  if (mode === 'anthropic') {
    return callAnthropicAPI(config, imageUrl, prompt, signal);
  }
  return callChatCompletions(config, imageUrl, prompt, signal);
}

/**
 * 校验 API 地址，避免把截图和密钥发往明文 HTTP。
 */
function validateApiUrl(rawUrl) {
  var url;
  try {
    url = new URL(rawUrl);
  } catch (_) {
    throw new Error('接口地址无效，请填写完整的 HTTPS URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error('接口地址必须使用 HTTPS，避免截图和 API Key 明文传输');
  }
  return url.toString();
}

/**
 * 包装 fetch 调用，捕获网络/跨域错误并输出更清晰的提示
 */
async function apiFetch(url, options) {
  try {
    return await fetch(validateApiUrl(url), options);
  } catch (err) {
    if (err.name === 'TypeError') {
      throw new Error('网络请求失败，请检查接口地址是否正确以及是否存在跨域限制 (CORS)。详情: ' + (err.message || err));
    }
    throw err;
  }
}

/**
 * 从 API 错误响应体中提取详细错误信息
 * 支持 OpenAI、Anthropic 等多种格式
 */
async function buildApiError(resp, prefix) {
  var detail = '';
  try {
    var errBody = await resp.clone().json();
    // OpenAI 兼容格式: { error: { message: '...' } }
    if (errBody.error) {
      if (typeof errBody.error === 'string') {
        detail = errBody.error;
      } else {
        detail = errBody.error.message || errBody.error.code || JSON.stringify(errBody.error);
      }
    } else if (errBody.message) {
      // Anthropic / 通用格式: { message: '...', type: '...' }
      detail = errBody.message;
    } else {
      detail = JSON.stringify(errBody).slice(0, 300);
    }
  } catch (_) {
    try {
      detail = (await resp.clone().text()).slice(0, 200);
    } catch (_) {}
  }
  if (detail && detail.length > 0) {
    return new Error(prefix + ' (' + resp.status + '): ' + detail);
  }
  return new Error(prefix + ' (' + resp.status + ')');
}

/**
 * OpenAI 兼容的 Chat Completions 调用
 * POST /v1/chat/completions
 */
async function callChatCompletions(config, imageUrl, prompt, signal) {
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
  // Merge custom body fields (auto-convert numeric strings to numbers)
  (config.customBodyFields || []).forEach(function (f) {
    if (f.key) {
      var num = Number(f.value);
      body[f.key] = isNaN(num) || f.value === '' ? f.value : num;
    }
  });

  const resp = await apiFetch(config.url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body),
    signal: signal
  });

  if (!resp.ok) {
    throw await buildApiError(resp, 'API调用失败');
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
async function callResponsesAPI(config, imageUrl, prompt, signal) {
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
    if (f.key) {
      var num = Number(f.value);
      body[f.key] = isNaN(num) || f.value === '' ? f.value : num;
    }
  });

  const resp = await apiFetch(config.url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body),
    signal: signal
  });

  if (!resp.ok) {
    throw await buildApiError(resp, 'API调用失败');
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
async function callAnthropicAPI(config, imageUrl, prompt, signal) {
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
    if (f.key) {
      var num = Number(f.value);
      body[f.key] = isNaN(num) || f.value === '' ? f.value : num;
    }
  });

  const resp = await apiFetch(config.url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body),
    signal: signal
  });

  if (!resp.ok) {
    throw await buildApiError(resp, 'API调用失败');
  }

  const data = await resp.json();
  const textBlock = data?.content?.find(function (item) { return item.type === 'text'; });
  const content = textBlock?.text;
  if (!content) {
    throw new Error('AI返回内容为空');
  }
  return content;
}
