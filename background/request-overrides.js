(function (root) {
  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
  }

  function cloneJson(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

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

  root.mergeJsonOverride = mergeJsonOverride;
  root.parseJsonObjectOverride = parseJsonObjectOverride;
  root.applyRequestOverrides = applyRequestOverrides;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      mergeJsonOverride: mergeJsonOverride,
      parseJsonObjectOverride: parseJsonObjectOverride,
      applyRequestOverrides: applyRequestOverrides
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
