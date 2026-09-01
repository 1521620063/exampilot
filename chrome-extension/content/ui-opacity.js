/**
 * 面板透明度工具：负责把用户设置的透明度规范化（0.01~1，保留两位小数）
 * 并应用到面板宿主元素上。面板与区域选区遮罩共用此逻辑。
 */

export var DEFAULT_UI_OPACITY = 1;

// 将任意输入（数字/字符串）规范化为合法透明度值，非法时回退到默认值
export function normalizeUiOpacity(value) {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return DEFAULT_UI_OPACITY;
  }
  var number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_UI_OPACITY;
  number = Math.max(0.01, Math.min(1, number));
  return Math.round(number * 100) / 100;
}

// 把规范化后的透明度直接写到宿主元素 style 上，并返回规范化结果
export function applyUiOpacity(host, value) {
  var normalized = normalizeUiOpacity(value);
  host.style.opacity = String(normalized);
  return normalized;
}
