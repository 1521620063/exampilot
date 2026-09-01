// AI 配置表单字段校验：返回错误文案，空字符串表示通过。
import { parseJsonObjectOverride, validateHttpsUrl } from './request-overrides.mjs';

function text(value) {
  return String(value || '').trim();
}

// 借助解析器校验 JSON 合法性，失败返回错误文案
function validateJsonObject(value, label) {
  if (!text(value)) return '';
  try {
    parseJsonObjectOverride(value, label);
    return '';
  } catch (_) {
    return label + ' 必须是有效的 JSON 对象';
  }
}

// 校验单个字段；自定义模板模式下模型名可不填
export function validateConfigField(config, field) {
  config = config || {};
  if (field === 'name') return text(config.name) ? '' : '请填写配置名称';
  if (field === 'url') {
    if (!text(config.url)) return '请填写接口地址';
    try {
      validateHttpsUrl(config.url);
      return '';
    } catch (error) {
      return error.message || '接口地址无效';
    }
  }
  if (field === 'model') return config.apiMode === 'custom-template' || text(config.model) ? '' : '请填写模型名称';
  if (field === 'customHeadersJson') return validateJsonObject(config.customHeadersJson, 'Headers JSON');
  if (field === 'customBodyJson') return validateJsonObject(config.customBodyJson, 'Body JSON');
  return '';
}

// 校验全部字段，返回 { 字段: 错误文案 } 映射
export function validateConfig(config) {
  var fields = ['name', 'url', 'model', 'customHeadersJson', 'customBodyJson'];
  return fields.reduce(function (errors, field) {
    var error = validateConfigField(config, field);
    if (error) errors[field] = error;
    return errors;
  }, {});
}
