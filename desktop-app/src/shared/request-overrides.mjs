import { cloneJson, isPlainObject } from './template-engine.mjs';

export function validateHttpsUrl(rawUrl) {
  var url;
  try { url = new URL(rawUrl); }
  catch (_) { throw new Error('接口地址无效，请填写完整的 HTTPS URL'); }
  if (url.protocol !== 'https:') throw new Error('接口地址必须使用 HTTPS');
  return url;
}

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

export function parseJsonObjectOverride(raw, label) {
  var text = String(raw || '').trim();
  if (!text) return {};
  var result;
  try { result = JSON.parse(text); }
  catch (error) { throw new Error(label + ' must be valid JSON: ' + (error.message || String(error))); }
  if (!isPlainObject(result)) throw new Error(label + ' must be a JSON object');
  return result;
}

export function applyRequestOverrides(headers, body, config) {
  return {
    headers: mergeJsonOverride(headers, parseJsonObjectOverride(config.customHeadersJson, 'Headers JSON')),
    body: mergeJsonOverride(body, parseJsonObjectOverride(config.customBodyJson, 'Body JSON'))
  };
}
