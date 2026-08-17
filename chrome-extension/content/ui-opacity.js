export var DEFAULT_UI_OPACITY = 1;

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

export function applyUiOpacity(host, value) {
  var normalized = normalizeUiOpacity(value);
  host.style.opacity = String(normalized);
  return normalized;
}
