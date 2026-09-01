export function buildSilentPrompt(prompt, width, height) {
  return String(prompt || '') + '\n\n【截图尺寸信息】\n当前发送给你的截图图片尺寸约为 ' + width + 'x' + height + ' 像素。\n百分比坐标以当前截图图片为参考：x=0 表示最左侧，x=1 表示最右侧，y=0 表示最上方，y=1 表示最下方。';
}

function percent(value, label) {
  var number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(label + ' 必须在 0 到 1 之间');
  return number;
}

function parseJson(value) {
  var text = String(value || '').trim();
  var fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  var start = text.indexOf('{');
  var end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('静默模式需要 AI 返回 JSON 对象');
  return JSON.parse(text.slice(start, end + 1));
}

function normalizeItem(item) {
  var answer = item.answer || item.text || item.result || item.correctAnswer || '';
  if (!String(answer).trim()) throw new Error('静默结果缺少 answer 字段');
  var box = item.bboxPercent || item.boxPercent || item.rectPercent || null;
  var point = item.coordinatePercent || item.coordinatesPercent || item.pointPercent || null;
  if (item.clipboardOnly === true || (!box && !point)) return { questionNumber: String(item.questionNumber || item.question || ''), answer: String(answer), clipboardOnly: true };
  var x;
  var y;
  var width = 0.02;
  var height = 0.02;
  if (box) {
    x = percent(box.x, 'bboxPercent.x'); y = percent(box.y, 'bboxPercent.y');
    width = percent(box.width, 'bboxPercent.width'); height = percent(box.height, 'bboxPercent.height');
    if (!width || !height || x + width > 1 || y + height > 1) throw new Error('bboxPercent 超出截图范围');
  }
  if (point) {
    var px = percent(point.x, 'coordinatePercent.x'); var py = percent(point.y, 'coordinatePercent.y');
    if (box && (px < x || px > x + width || py < y || py > y + height)) throw new Error('coordinatePercent 必须落在 bboxPercent 内');
    if (!box) {
      x = Math.min(Math.max(0, px - width / 2), 1 - width);
      y = Math.min(Math.max(0, py - height / 2), 1 - height);
    }
  }
  return { questionNumber: String(item.questionNumber || item.question || ''), answer: String(answer), clipboardOnly: false, target: { x: x, y: y, width: width, height: height } };
}

export function normalizeSilentResult(answer) {
  var parsed = parseJson(answer);
  var items = Array.isArray(parsed.items) ? parsed.items : (Array.isArray(parsed.targets) ? parsed.targets : [parsed]);
  var normalized = items.map(normalizeItem);
  var clipboardText = normalized.filter(function (item) { return item.clipboardOnly; }).map(function (item) { return (item.questionNumber ? item.questionNumber + ': ' : '') + item.answer; }).join('\n');
  return { targets: normalized.filter(function (item) { return item.target; }), clipboardText: clipboardText };
}

export function mapTargetsToMonitor(targets, capture) {
  var monitor = capture && capture.monitor;
  var rect = capture && capture.captureRect;
  if (!monitor || !monitor.width || !monitor.height) throw new Error('截图缺少显示器坐标信息');
  if (!rect) rect = { x: 0, y: 0, width: monitor.width, height: monitor.height };
  return (targets || []).map(function (item) {
    var target = item.target || item;
    return {
      x: (rect.x + target.x * rect.width) / monitor.width,
      y: (rect.y + target.y * rect.height) / monitor.height,
      width: target.width * rect.width / monitor.width,
      height: target.height * rect.height / monitor.height
    };
  });
}
