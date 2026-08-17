(function (root) {
  function mergeJsonOverride(base, override) {
    var result = isPlainObject(base) ? cloneJson(base) : {};
    var patch = isPlainObject(override) ? override : {};

    Object.keys(patch).forEach(function (key) {
      var value = patch[key];
      if (value === null) {
        delete result[key];
        return;
      }
      if (isPlainObject(value) && isPlainObject(result[key])) {
        result[key] = mergeJsonOverride(result[key], value);
        return;
      }
      result[key] = cloneJson(value);
    });

    return result;
  }

  function parseJsonObjectOverride(rawValue, label) {
    var text = (rawValue || '').trim();
    if (!text) return {};

    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(label + ' 不是有效的 JSON: ' + (err.message || String(err)));
    }

    if (!isPlainObject(parsed)) {
      throw new Error(label + ' 必须是 JSON 对象');
    }
    return parsed;
  }

  function applyRequestOverrides(baseHeaders, baseBody, config) {
    var headersOverride = parseJsonObjectOverride(config.customHeadersJson, 'Headers JSON');
    var bodyOverride = parseJsonObjectOverride(config.customBodyJson, 'Body JSON');
    return {
      headers: mergeJsonOverride(baseHeaders, headersOverride),
      body: mergeJsonOverride(baseBody, bodyOverride)
    };
  }

  /**
   * 解析并验证 HTTPS URL，返回 URL 对象供调用方按需使用。
   * 合并 query-ai.js 的 validateApiUrl 和 background/index.js 的 apiUrlToPermissionPattern 中的重复逻辑。
   */
  function validateHttpsUrl(rawUrl) {
    var url;
    try {
      url = new URL(rawUrl);
    } catch (_) {
      throw new Error('接口地址无效，请填写完整的 HTTPS URL');
    }
    if (url.protocol !== 'https:') {
      throw new Error('接口地址必须使用 HTTPS，避免截图和 API Key 明文传输');
    }
    return url;
  }

  root.validateHttpsUrl = validateHttpsUrl;
  root.mergeJsonOverride = mergeJsonOverride;
  root.parseJsonObjectOverride = parseJsonObjectOverride;
  root.applyRequestOverrides = applyRequestOverrides;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      validateHttpsUrl: validateHttpsUrl,
      mergeJsonOverride: mergeJsonOverride,
      parseJsonObjectOverride: parseJsonObjectOverride,
      applyRequestOverrides: applyRequestOverrides
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
