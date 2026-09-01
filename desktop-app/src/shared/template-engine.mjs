// 极简 JSON 模板引擎（与扩展共享）：支持 {{path}} 变量插值，路径支持点号、数组下标与引号键。
export function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

export function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function parseJson(raw, label) {
  var text = String(raw || '').trim();
  if (!text) throw new Error(label + ' cannot be empty');
  try { return JSON.parse(text); }
  catch (error) { throw new Error(label + ' must be valid JSON: ' + (error.message || String(error))); }
}

// 把 "a.b[0][\"c\"]" 形式的路径解析为键序列
export function parseTemplatePath(path) {
  var text = String(path || '').trim();
  if (!text) throw new Error('Template variable cannot be empty');
  var tokens = [];
  var name = '';
  var index = 0;
  function pushName() { if (name.trim()) tokens.push(name.trim()); name = ''; }
  while (index < text.length) {
    if (text[index] === '.') { pushName(); index += 1; continue; }
    if (text[index] !== '[') { name += text[index]; index += 1; continue; }
    pushName();
    var end = text.indexOf(']', index + 1);
    if (end === -1) throw new Error('Invalid template variable path: ' + path);
    var part = text.slice(index + 1, end).trim();
    if ((part[0] === '"' && part[part.length - 1] === '"') || (part[0] === "'" && part[part.length - 1] === "'")) tokens.push(part.slice(1, -1));
    else if (/^\d+$/.test(part)) tokens.push(Number(part));
    else if (part) tokens.push(part);
    else throw new Error('Invalid template variable path: ' + path);
    index = end + 1;
  }
  pushName();
  if (!tokens.length) throw new Error('Invalid template variable path: ' + path);
  return tokens;
}

export function resolveTemplatePath(source, path, label) {
  var current = source;
  parseTemplatePath(path).forEach(function (key) {
    if (current === null || current === undefined || !(key in Object(current))) throw new Error(label + ' variable does not exist: ' + String(path).trim());
    current = current[key];
  });
  return current;
}

// 整串恰为一个 {{path}} 时返回原始值（保留类型），否则做字符串插值
export function renderTemplateString(template, context, label) {
  var exact = String(template).match(/^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/);
  if (exact) return cloneJson(resolveTemplatePath(context, exact[1], label));
  return String(template).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, function (_, path) {
    var value = resolveTemplatePath(context, path, label);
    if (value === null || value === undefined) return '';
    return isPlainObject(value) || Array.isArray(value) ? JSON.stringify(value) : String(value);
  });
}

// 递归渲染 JSON 模板中的全部字符串值
export function renderJsonTemplateValue(value, context, label) {
  if (typeof value === 'string') return renderTemplateString(value, context, label);
  if (Array.isArray(value)) return value.map(function (item) { return renderJsonTemplateValue(item, context, label); });
  if (!isPlainObject(value)) return cloneJson(value);
  var result = {};
  Object.keys(value).forEach(function (key) { result[key] = renderJsonTemplateValue(value[key], context, label); });
  return result;
}

export function renderJsonTemplate(raw, context, label) {
  return renderJsonTemplateValue(parseJson(raw, label), context || {}, label);
}

// 渲染并要求结果为 JSON 对象（用于 Headers 模板）
export function renderJsonObjectTemplate(raw, context, label) {
  var result = renderJsonTemplate(raw, context, label);
  if (!isPlainObject(result)) throw new Error(label + ' must be a JSON object');
  return result;
}

// 用模型响应作为上下文渲染响应模板，非字符串结果转 JSON 文本
export function renderResponseTemplate(raw, response, label) {
  var text = String(raw || '').trim();
  if (!text) throw new Error(label + ' cannot be empty');
  var result = renderTemplateString(text, response || {}, label);
  return result === null || result === undefined ? '' : typeof result === 'string' ? result : JSON.stringify(result);
}

export function getDefaultTemplateHeadersJson() { return '{\n  "Content-Type": "application/json",\n  "Authorization": "Bearer {{apiKey}}"\n}'; }
export function getDefaultTemplateBodyJson() { return '{\n  "model": "{{model}}",\n  "messages": [{\n    "role": "user",\n    "content": [\n      { "type": "image_url", "image_url": { "url": "{{imageUrl}}" } },\n      { "type": "text", "text": "{{prompt}}" }\n    ]\n  }]\n}'; }
export function getDefaultTemplateResponseText() { return '{{choices[0].message.content}}'; }
