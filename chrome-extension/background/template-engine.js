/**
 * template-engine.js —— 轻量 JSON 模板引擎
 * 支持 {{path.to.value[0]}} 变量插值：用于渲染自定义请求的
 * Headers/Body 模板，以及从 AI 响应 JSON 中提取答案文本。
 */
(function (root) {
  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
  }

  function cloneJson(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function parseJsonTemplate(rawValue, label) {
    var text = (rawValue || '').trim();
    if (!text) {
      throw new Error(label + ' 不能为空');
    }
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(label + ' 不是有效的 JSON: ' + (err.message || String(err)));
    }
  }

  /** 将 "a.b[0]['c']" 形式的模板路径解析为 token 数组 */
  function parseTemplatePath(path) {
    var text = String(path || '').trim();
    if (!text) {
      throw new Error('模板变量不能为空');
    }

    var tokens = [];
    var name = '';
    var i = 0;

    function pushName() {
      var token = name.trim();
      if (token) tokens.push(token);
      name = '';
    }

    while (i < text.length) {
      var ch = text[i];
      if (ch === '.') {
        pushName();
        i += 1;
        continue;
      }
      if (ch === '[') {
        pushName();
        var end = text.indexOf(']', i + 1);
        if (end === -1) {
          throw new Error('模板变量路径格式错误: ' + path);
        }
        var part = text.slice(i + 1, end).trim();
        if ((part[0] === '"' && part[part.length - 1] === '"') || (part[0] === "'" && part[part.length - 1] === "'")) {
          tokens.push(part.slice(1, -1));
        } else if (/^\d+$/.test(part)) {
          tokens.push(Number(part));
        } else if (part) {
          tokens.push(part);
        } else {
          throw new Error('模板变量路径格式错误: ' + path);
        }
        i = end + 1;
        continue;
      }
      name += ch;
      i += 1;
    }

    pushName();
    if (!tokens.length) {
      throw new Error('模板变量路径格式错误: ' + path);
    }
    return tokens;
  }

  /** 按 token 逐级取值，任一级缺失即抛错 */
  function resolveTemplatePath(source, path, label) {
    var tokens = parseTemplatePath(path);
    var current = source;
    for (var i = 0; i < tokens.length; i++) {
      var key = tokens[i];
      if (current === null || current === undefined || !(key in Object(current))) {
        throw new Error(label + ' 变量不存在: ' + String(path).trim());
      }
      current = current[key];
    }
    return current;
  }

  /** 整串仅含一个 {{var}} 时保留原始类型返回；否则做字符串插值（对象/数组转 JSON） */
  function renderTemplateString(template, context, label) {
    var exact = String(template).match(/^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/);
    if (exact) {
      return cloneJson(resolveTemplatePath(context, exact[1], label));
    }

    return String(template).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, function (_, path) {
      var value = resolveTemplatePath(context, path, label);
      if (value === null || value === undefined) return '';
      if (isPlainObject(value) || Array.isArray(value)) return JSON.stringify(value);
      return String(value);
    });
  }

  /** 递归渲染 JSON 模板中的字符串叶子节点 */
  function renderJsonTemplateValue(value, context, label) {
    if (typeof value === 'string') {
      return renderTemplateString(value, context, label);
    }
    if (Array.isArray(value)) {
      return value.map(function (item) {
        return renderJsonTemplateValue(item, context, label);
      });
    }
    if (isPlainObject(value)) {
      var rendered = {};
      Object.keys(value).forEach(function (key) {
        rendered[key] = renderJsonTemplateValue(value[key], context, label);
      });
      return rendered;
    }
    return cloneJson(value);
  }

  function renderJsonTemplate(rawValue, context, label) {
    return renderJsonTemplateValue(parseJsonTemplate(rawValue, label), context || {}, label);
  }

  function renderJsonObjectTemplate(rawValue, context, label) {
    var rendered = renderJsonTemplate(rawValue, context, label);
    if (!isPlainObject(rendered)) {
      throw new Error(label + ' 必须是 JSON 对象');
    }
    return rendered;
  }

  /** 从 AI 响应 JSON 中按模板路径提取答案文本 */
  function renderResponseTemplate(rawValue, responseJson, label) {
    var text = (rawValue || '').trim();
    if (!text) {
      throw new Error(label + ' 不能为空');
    }
    var rendered = renderTemplateString(text, responseJson || {}, label);
    if (rendered === null || rendered === undefined) return '';
    if (typeof rendered === 'string') return rendered;
    return JSON.stringify(rendered);
  }

  function getDefaultTemplateHeadersJson() {
    return '{\n  "Content-Type": "application/json",\n  "Authorization": "Bearer {{apiKey}}"\n}';
  }

  function getDefaultTemplateBodyJson() {
    return '{\n  "model": "{{model}}",\n  "messages": [\n    {\n      "role": "user",\n      "content": [\n        { "type": "image_url", "image_url": { "url": "{{imageUrl}}" } },\n        { "type": "text", "text": "{{prompt}}" }\n      ]\n    }\n  ]\n}';
  }

  function getDefaultTemplateResponseText() {
    return '{{choices[0].message.content}}';
  }

  root.isPlainObject = isPlainObject;
  root.cloneJson = cloneJson;
  root.parseJsonTemplate = parseJsonTemplate;
  root.parseTemplatePath = parseTemplatePath;
  root.resolveTemplatePath = resolveTemplatePath;
  root.renderTemplateString = renderTemplateString;
  root.renderJsonTemplateValue = renderJsonTemplateValue;
  root.renderJsonTemplate = renderJsonTemplate;
  root.renderJsonObjectTemplate = renderJsonObjectTemplate;
  root.renderResponseTemplate = renderResponseTemplate;
  root.getDefaultTemplateHeadersJson = getDefaultTemplateHeadersJson;
  root.getDefaultTemplateBodyJson = getDefaultTemplateBodyJson;
  root.getDefaultTemplateResponseText = getDefaultTemplateResponseText;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      isPlainObject: isPlainObject,
      cloneJson: cloneJson,
      parseJsonTemplate: parseJsonTemplate,
      parseTemplatePath: parseTemplatePath,
      resolveTemplatePath: resolveTemplatePath,
      renderTemplateString: renderTemplateString,
      renderJsonTemplateValue: renderJsonTemplateValue,
      renderJsonTemplate: renderJsonTemplate,
      renderJsonObjectTemplate: renderJsonObjectTemplate,
      renderResponseTemplate: renderResponseTemplate,
      getDefaultTemplateHeadersJson: getDefaultTemplateHeadersJson,
      getDefaultTemplateBodyJson: getDefaultTemplateBodyJson,
      getDefaultTemplateResponseText: getDefaultTemplateResponseText
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
