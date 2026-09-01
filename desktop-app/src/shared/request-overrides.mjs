// 自定义请求覆盖（与扩展共享）：HTTPS 校验、用户 Headers/Body JSON 与默认请求的深度合并。
import { cloneJson, isPlainObject } from './template-engine.mjs';

// 接口地址必须是合法的 HTTPS URL
export function validateHttpsUrl(rawUrl) {
  var url;
  try { url = new URL(rawUrl); }
  catch (_) { throw new Error('接口地址无效，请填写完整的 HTTPS URL'); }
  if (url.protocol !== 'https:') throw new Error('接口地址必须使用 HTTPS');
  return url;
}

// 深度合并覆盖对象；覆盖值为 null 表示删除该键
export function mergeJsonOverride(base, override) {
  var result = isPlainObject(base) ? cloneJson(base) : {};
  var patch = isPlainObject(override) ? override : {};
  Object.keys(patch).forEach(function (key) {
    var value = patch[key];
    if (value === null) delete result[key];
    else if (isPlainObject(value) && isPlainObject(result[key])) result[key] = mergeJsonOverride(result[key], value);
    else result[key] = cloneJson(value);
  });
  return result;
}

// 解析并校验必须为 JSON 对象，空串视为空对象
export function parseJsonObjectOverride(raw, label) {
  var text = String(raw || '').trim();
  if (!text) return {};
  var result;
  try { result = JSON.parse(text); }
  catch (error) { throw new Error(label + ' must be valid JSON: ' + (error.message || String(error))); }
  if (!isPlainObject(result)) throw new Error(label + ' must be a JSON object');
  return result;
}

// 把用户自定义 Headers/Body 合并进默认请求
export function applyRequestOverrides(headers, body, config) {
  return {
    headers: mergeJsonOverride(headers, parseJsonObjectOverride(config.customHeadersJson, 'Headers JSON')),
    body: mergeJsonOverride(body, parseJsonObjectOverride(config.customBodyJson, 'Body JSON'))
  };
}
