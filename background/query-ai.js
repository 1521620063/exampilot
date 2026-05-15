/**
 * 调用视觉大模型识别图片中的题目并求解
 *
 * 支持多种 API 模式（通过 config.apiMode 切换）：
 *   - chat-completions: OpenAI 兼容的 /v1/chat/completions 接口
 *   - responses-api: OpenAI Responses API (/v1/responses)
 *
 * @param {string} imageUrl - 图片 URL（HTTP 地址或 data:image/... base64 均可）
 * @returns {Promise<string>} 模型返回的格式化解题内容（含 HTML 标记）
 */
async function queryAI(imageUrl) {
  // 获取当前选中的 AI 配置
  const config = await getActiveConfig();
  const mode = config.apiMode || 'chat-completions';

  // 系统提示词：要求模型识别题目、给出答案，并强制规定输出格式
  const prompt = `解析图片中的内容。

如果图片中有题目：
请识别题目并解答。

严格按照下面格式输出：

题目："xxx"

<br/>

<b>答案："xxx"</b>

不要输出多余内容。`;

  if (mode === 'responses-api') {
    return callResponsesAPI(config, imageUrl, prompt);
  }
  // 默认：Chat Completions 模式
  return callChatCompletions(config, imageUrl, prompt);
}

/**
 * OpenAI 兼容的 Chat Completions 调用
 * POST /v1/chat/completions
 */
async function callChatCompletions(config, imageUrl, prompt) {
  const resp = await fetch(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: prompt }
        ]
      }]
    })
  });

  if (!resp.ok) {
    throw new Error(`API调用失败 (${resp.status})`);
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
  const resp = await fetch(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      input: [{
        role: 'user',
        content: [
          { type: 'input_image', image_url: imageUrl },
          { type: 'input_text', text: prompt }
        ]
      }]
    })
  });

  if (!resp.ok) {
    throw new Error(`API调用失败 (${resp.status})`);
  }

  const data = await resp.json();
  // Responses API 返回结构：output 数组可能包含 reasoning、message 等多种类型
  // 需要找到 type: 'message' 的输出项来读取回答内容
  const messageOutput = data?.output?.find(function (item) { return item.type === 'message'; });
  const content = messageOutput?.content?.[0]?.text;
  if (!content) {
    throw new Error('AI返回内容为空');
  }
  return content;
}
