importScripts('template-engine.js', 'request-overrides.js', 'settings-transfer.js', 'query-ai.js');

var currentAbortController = null;
var IS_FULL_ACCESS = __EXAMPILOT_FULL_ACCESS__;
var DEFAULT_SILENT_SCROLL_PIXELS = 5;
var DEFAULT_PROMPT = '解析图片中的内容。\n\n如果图片中有题目：\n请识别题目并解答。\n\n严格按照下面格式输出：\n\n题目："xxx"\n\n<br/>\n\n<b>答案："xxx"</b>\n\n不要输出多余内容。';
var DEFAULT_SILENT_PROMPT = '请识别图片中所有完整显示的题目。只返回一个 JSON 对象，不要使用 Markdown 代码块，不要输出多余文字。\n' +
  '不要定位到题干空白、横线、输入框、解析区域或未完整显示的题目。\n' +
  '选择题必须返回正确选项本身的位置：bboxPercent 要框住正确选项行，至少包含选项字母圆圈和选项文本；coordinatePercent 要落在这个 bboxPercent 内。\n' +
  '简答题、填空题、编程题等没有可悬浮正确选项的题目，不要编造坐标，只返回答案文本，并设置 "clipboardOnly": true。\n' +
  '如果编程题已经给定了部分代码、函数签名、类定义、输入输出处理或注释要求，请在已有内容基础上补全，不要重写无关结构，不要删除题目给定的代码。\n' +
  'JSON 格式必须为：{"items":[{"questionNumber":"题号","answer":"正确答案文本","choice":"A/B/C/D 等选项字母","coordinatePercent":{"x":0到1的小数,"y":0到1的小数},"bboxPercent":{"x":0到1的小数,"y":0到1的小数,"width":0到1的小数,"height":0到1的小数}},{"questionNumber":"题号","answer":"简答/编程题答案文本","clipboardOnly":true}]}';

function normalizeSilentScrollPixels(value) {
  var number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_SILENT_SCROLL_PIXELS;
  return Math.max(0, Math.min(Math.round(number), 200));
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'exampilotPing' });
  } catch (error) {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content/bundle/content-bundle.js']
    });
  }
}

chrome.action.onClicked.addListener(function (tab) {
  if (!tab || !tab.id) return;
  if (IS_FULL_ACCESS) {
    chrome.tabs.sendMessage(tab.id, { action: 'togglePanelFromAction' }).catch(function (err) {
      console.error('切换面板失败:', err);
    });
    return;
  }
  ensureContentScript(tab.id).catch(function (err) {
    console.error('注入内容脚本失败:', err);
  });
});

/**
 * 确保活动标签页已加载内容脚本，然后让面板发起截图流程。
 * 快捷键可以在面板尚未打开时直接使用。
 */
async function startCaptureFromCommand(command) {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  var tab = tabs[0];
  if (!tab || !tab.id) {
    throw new Error('未找到当前标签页');
  }

  if (!IS_FULL_ACCESS) {
    await ensureContentScript(tab.id);
  }

  await chrome.tabs.sendMessage(tab.id, {
    action: 'startCaptureFromCommand',
    mode: command === 'capture-region' ? 'region' : 'fullscreen'
  });
}

/** 确保内容脚本已注入，然后触发面板中的清除动作。 */
async function clearResultsFromCommand() {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  var tab = tabs[0];
  if (!tab || !tab.id) {
    throw new Error('未找到当前标签页');
  }

  if (!IS_FULL_ACCESS) {
    await ensureContentScript(tab.id);
  }

  await chrome.tabs.sendMessage(tab.id, { action: 'clearResultsFromCommand' });
}

/**
 * 按列表顺序循环切换当前 AI 配置。
 * @returns {Promise<Object>} 切换后的配置
 */
async function switchActiveConfigFromCommand() {
  var data = await chrome.storage.local.get('configList');
  var configList = data.configList || [];
  if (configList.length === 0) {
    throw new Error('请先添加 AI 配置');
  }

  var activeIndex = configList.findIndex(function (config) { return config.selected; });
  if (activeIndex === -1) activeIndex = 0;
  var nextIndex = (activeIndex + 1) % configList.length;

  configList.forEach(function (config, index) {
    config.selected = index === nextIndex;
  });
  await chrome.storage.local.set({ configList: configList });
  return configList[nextIndex];
}

async function notifyConfigSwitched(config) {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  var tab = tabs[0];
  if (!tab || !tab.id) return;
  await chrome.tabs.sendMessage(tab.id, {
    action: 'activeConfigChanged',
    configName: config.name || '未命名配置'
  }).catch(function () {});
}

// 扩展级快捷键：截图及 AI 配置循环切换。
chrome.commands.onCommand.addListener(function (command) {
  if (command === 'capture-fullscreen' || command === 'capture-region') {
    startCaptureFromCommand(command).catch(function (error) {
      console.error('快捷键截图启动失败:', error);
    });
    return;
  }

  if (command === 'switch-config') {
    switchActiveConfigFromCommand().then(notifyConfigSwitched).catch(function (error) {
      console.error('快捷键切换配置失败:', error);
    });
    return;
  }

  if (command === 'clear-results') {
    clearResultsFromCommand().catch(function (error) {
      console.error('快捷键清除/取消失败:', error);
    });
    return;
  }
});

// ====== 配置初始化与管理 ======

/** 首次启动时初始化空的配置列表，含旧格式迁移 */
async function ensureConfigInitialized() {
  const data = await chrome.storage.local.get(['configList', 'activeConfigId']);
  const { configList } = data;

  // 首次运行：创建空列表
  if (configList === undefined) {
    await chrome.storage.local.set({ configList: [] });
    return;
  }

  // 从旧格式（activeConfigId）迁移到新格式（selected 字段）
  if (configList.length > 0 && configList[0].selected === undefined) {
    var migrated = configList.map(function (c) {
      return Object.assign({}, c, { selected: c.id === data.activeConfigId });
    });
    autoSelectFallback(migrated);
    await chrome.storage.local.set({ configList: migrated });
  }
}

/** 首次启动时初始化默认提示词 */
async function ensurePromptInitialized() {
  const data = await chrome.storage.local.get(['customPrompt', 'silentPrompt']);
  var updates = {};
  if (data.customPrompt === undefined) {
    updates.customPrompt = DEFAULT_PROMPT;
  }
  if (data.silentPrompt === undefined) {
    updates.silentPrompt = DEFAULT_SILENT_PROMPT;
  }
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
}

/** 首次启动时初始化全局静默模式设置 */
async function ensureSilentModeInitialized() {
  var data = await chrome.storage.local.get(['silentModeEnabled', 'silentScrollPixels', 'silentDebugFrameEnabled']);
  var updates = {};
  if (data.silentModeEnabled === undefined) {
    updates.silentModeEnabled = false;
  }
  if (data.silentScrollPixels === undefined) {
    updates.silentScrollPixels = DEFAULT_SILENT_SCROLL_PIXELS;
  }
  if (data.silentDebugFrameEnabled === undefined) {
    updates.silentDebugFrameEnabled = false;
  }
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
}

/** 确保至少有一个 selected，否则选中第一个 */
function autoSelectFallback(list) {
  if (list.length > 0 && !list.some(function (c) { return c.selected; })) {
    list[0].selected = true;
  }
}

function apiUrlToPermissionPattern(rawUrl) {
  var url = validateHttpsUrl(rawUrl);
  return url.protocol + '//' + url.hostname + '/*';
}

/**
 * 检查当前扩展是否已获得目标 API 域名的可选 host permission。
 */
async function checkApiHostPermission(rawUrl) {
  var origin = apiUrlToPermissionPattern(rawUrl);
  if (IS_FULL_ACCESS) {
    return { origin: origin, granted: true };
  }
  var permission = { origins: [origin] };
  var granted = await chrome.permissions.contains(permission);
  return { origin: origin, granted: granted };
}

/**
 * 普通版在网络请求前确认 optional host permission；Full Access 版直接放行。
 */
async function assertApiHostPermission(rawUrl) {
  var status = await checkApiHostPermission(rawUrl);
  if (!status.granted) {
    throw new Error('请先授权访问 ' + status.origin + ' 后再调用该接口');
  }
  return status.origin;
}

/** 获取当前选中的 AI 配置（供 query-ai.js 调用） */
async function getActiveConfig() {
  const { configList } = await chrome.storage.local.get('configList');
  if (configList && configList.length > 0) {
    var selected = configList.find(function (c) { return c.selected; });
    if (selected) {
      // 确保旧数据有默认值
      if (!selected.apiMode) {
        selected.apiMode = 'chat-completions';
      }
      if (selected.customHeadersJson === undefined) selected.customHeadersJson = '';
      if (selected.customBodyJson === undefined) selected.customBodyJson = '';
      if (selected.templateHeadersJson === undefined) selected.templateHeadersJson = '';
      if (selected.templateBodyJson === undefined) selected.templateBodyJson = '';
      if (selected.templateResponseText === undefined) selected.templateResponseText = '';
      return selected;
    }
    throw new Error('请先点击 ⚙️ 选择 AI 配置');
  }
  throw new Error('请先点击 ⚙️ 添加 AI 配置');
}

/**
 * 包装后台消息处理器的异步操作，统一处理成功/失败响应。
 * 消除每个消息处理器中的重复 catch(sendResponse) 样板代码。
 */
function asyncHandler(fn) {
  return function (request, sender, sendResponse) {
    Promise.resolve(fn(request, sender)).then(function (result) {
      sendResponse(result);
    }).catch(function (error) {
      sendResponse({ success: false, error: error.message || String(error) });
    });
    return true;
  };
}

// 启动时初始化 / 迁移配置
ensureConfigInitialized();
ensurePromptInitialized();
ensureSilentModeInitialized();

function buildSilentPrompt(prompt, rect, viewport) {
  var dpr = Number((rect && rect.dpr) || (viewport && viewport.dpr) || 1);
  var cssWidth = rect ? Number(rect.width) : Number(viewport && viewport.width);
  var cssHeight = rect ? Number(rect.height) : Number(viewport && viewport.height);
  var imageWidth = Number.isFinite(cssWidth) ? Math.round(cssWidth * dpr) : 0;
  var imageHeight = Number.isFinite(cssHeight) ? Math.round(cssHeight * dpr) : 0;
  var sizeHint = imageWidth > 0 && imageHeight > 0
    ? '当前发送给你的截图图片尺寸约为 ' + imageWidth + 'x' + imageHeight + ' 像素。'
    : '';
  return String(prompt || DEFAULT_SILENT_PROMPT) + '\n\n' +
    '【截图尺寸信息】\n' +
    sizeHint + '\n' +
    '百分比坐标以当前截图图片为参考：x=0 表示最左侧，x=1 表示最右侧，y=0 表示最上方，y=1 表示最下方。';
}

function extractJsonObjectText(value) {
  var text = String(value || '').trim();
  var fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  var start = text.indexOf('{');
  var end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('静默模式需要 AI 返回 JSON 对象，请检查提示词或响应模板');
  }
  return text.slice(start, end + 1);
}

function readFiniteNumber(value, label) {
  var number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error('静默模式返回的 ' + label + ' 必须是数字');
  }
  return number;
}

function pickSilentTarget(data) {
  return data.target || data.coordinatePercent || data.coordinatesPercent || data.pointPercent || data.coordinate || data.coordinates || data.point || data.bboxPercent || data.bbox || data.box || data.rect || data;
}

function hasSilentPositionData(data) {
  return !!(data && (data.target || data.coordinatePercent || data.coordinatesPercent || data.pointPercent ||
    data.coordinate || data.coordinates || data.point || data.bboxPercent || data.boxPercent ||
    data.rectPercent || data.bbox || data.box || data.rect));
}

function hasPercentTarget(data) {
  return !!(data.coordinatePercent || data.coordinatesPercent || data.pointPercent || data.bboxPercent ||
    (data.target && (data.target.unit === 'percent' || data.target.units === 'percent')));
}

function validatePercentRange(value, label) {
  var number = readFiniteNumber(value, label);
  if (number < 0 || number > 1) {
    throw new Error('静默模式返回的 ' + label + ' 必须在 0 到 1 之间');
  }
  return number;
}

function pickPercentPoint(data) {
  return data.coordinatePercent || data.coordinatesPercent || data.pointPercent ||
    (data.target && (data.target.unit === 'percent' || data.target.units === 'percent') ? data.target : null);
}

function pickPercentBox(data) {
  return data.bboxPercent || data.boxPercent || data.rectPercent ||
    (data.target && data.target.bboxPercent) ||
    (data.target && (data.target.unit === 'percent' || data.target.units === 'percent') && data.target.width !== undefined ? data.target : null);
}

function normalizeSilentTarget(parsed, rect, viewport) {
  try {
    if (!parsed || typeof parsed !== 'object') throw new Error('目标不是 JSON 对象');
  } catch (error) {
    throw new Error('静默模式返回内容中的题目格式无效: ' + (error.message || String(error)));
  }

  var answer = parsed.answer || parsed.text || parsed.result || parsed.correctAnswer || '';
  if (!String(answer).trim()) {
    throw new Error('静默模式返回内容缺少 answer 字段');
  }
  var choice = parsed.choice || parsed.option || parsed.optionLabel || parsed.answerLabel || '';

  if (parsed.clipboardOnly === true || !hasSilentPositionData(parsed)) {
    return {
      questionNumber: String(parsed.questionNumber || parsed.question || parsed.index || ''),
      answer: String(answer),
      choice: String(choice || ''),
      raw: null,
      target: null,
      clipboardOnly: true
    };
  }

  var target = pickSilentTarget(parsed);
  if (!target || typeof target !== 'object') {
    return {
      questionNumber: String(parsed.questionNumber || parsed.question || parsed.index || ''),
      answer: String(answer),
      choice: String(choice || ''),
      raw: null,
      target: null,
      clipboardOnly: true
    };
  }

  var sourceWidth = rect ? Number(rect.width) : Number(viewport && viewport.width);
  var sourceHeight = rect ? Number(rect.height) : Number(viewport && viewport.height);
  if (!Number.isFinite(sourceWidth) || sourceWidth <= 0 || !Number.isFinite(sourceHeight) || sourceHeight <= 0) {
    throw new Error('静默模式缺少截图视口尺寸');
  }

  var localX;
  var localY;
  var rawX;
  var rawY;
  var rawWidth;
  var rawHeight;
  var width = Number(target.width);
  var height = Number(target.height);
  var hasSize = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  var unit = hasPercentTarget(parsed) ? 'percent' : 'pixel';

  if (unit === 'percent') {
    var percentPoint = pickPercentPoint(parsed);
    var percentBox = pickPercentBox(parsed);
    if (percentBox && typeof percentBox === 'object') {
      var boxX = validatePercentRange(percentBox.x, 'bboxPercent.x');
      var boxY = validatePercentRange(percentBox.y, 'bboxPercent.y');
      var boxWidth = validatePercentRange(percentBox.width, 'bboxPercent.width');
      var boxHeight = validatePercentRange(percentBox.height, 'bboxPercent.height');
      if (boxWidth <= 0 || boxHeight <= 0) {
        throw new Error('静默模式返回的 bboxPercent.width/height 必须大于 0');
      }
      if (boxX + boxWidth > 1 || boxY + boxHeight > 1) {
        throw new Error('静默模式返回的 bboxPercent 超出截图范围');
      }
      rawX = boxX;
      rawY = boxY;
      rawWidth = boxWidth;
      rawHeight = boxHeight;
      width = boxWidth * sourceWidth;
      height = boxHeight * sourceHeight;
      localX = boxX * sourceWidth + width / 2;
      localY = boxY * sourceHeight + height / 2;
      if (percentPoint && percentPoint.x !== undefined && percentPoint.y !== undefined) {
        rawX = validatePercentRange(percentPoint.x, 'coordinatePercent.x');
        rawY = validatePercentRange(percentPoint.y, 'coordinatePercent.y');
        if (rawX < boxX || rawX > boxX + boxWidth || rawY < boxY || rawY > boxY + boxHeight) {
          throw new Error('静默模式返回的 coordinatePercent 必须落在 bboxPercent 内');
        }
        localX = rawX * sourceWidth;
        localY = rawY * sourceHeight;
      }
    } else if (percentPoint && typeof percentPoint === 'object') {
      rawX = validatePercentRange(percentPoint.x, 'coordinatePercent.x');
      rawY = validatePercentRange(percentPoint.y, 'coordinatePercent.y');
      rawWidth = 32 / sourceWidth;
      rawHeight = 32 / sourceHeight;
      localX = rawX * sourceWidth;
      localY = rawY * sourceHeight;
      width = 32;
      height = 32;
    } else {
      throw new Error('静默模式返回内容缺少 coordinatePercent/bboxPercent 坐标字段');
    }
  }

  if (unit !== 'percent' && !hasSize && parsed.bbox && typeof parsed.bbox === 'object') {
    width = Number(parsed.bbox.width);
    height = Number(parsed.bbox.height);
    hasSize = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  }

  if (unit !== 'percent' && target.bbox && typeof target.bbox === 'object') {
    target = target.bbox;
    width = Number(target.width);
    height = Number(target.height);
    hasSize = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  }

  if (unit !== 'percent' && hasSize && target.x !== undefined && target.y !== undefined && parsed.coordinate === undefined && parsed.coordinates === undefined && parsed.point === undefined) {
    localX = readFiniteNumber(target.x, 'bbox.x') + width / 2;
    localY = readFiniteNumber(target.y, 'bbox.y') + height / 2;
  } else if (unit !== 'percent') {
    localX = readFiniteNumber(target.x, 'coordinate.x');
    localY = readFiniteNumber(target.y, 'coordinate.y');
    if (!hasSize) {
      width = 32;
      height = 32;
    }
  }
  if (unit !== 'percent') {
    rawX = localX;
    rawY = localY;
    rawWidth = width;
    rawHeight = height;
  }

  var dpr = Number((rect && rect.dpr) || (viewport && viewport.dpr) || 1);
  if (!Number.isFinite(dpr) || dpr <= 0) dpr = 1;
  var imageWidth = sourceWidth * dpr;
  var imageHeight = sourceHeight * dpr;
  if (unit !== 'percent' && (localX > sourceWidth || localY > sourceHeight) && localX <= imageWidth && localY <= imageHeight) {
    localX = localX / dpr;
    localY = localY / dpr;
    width = width / dpr;
    height = height / dpr;
  }
  if (localX < 0 || localY < 0 || localX > sourceWidth || localY > sourceHeight) {
    throw new Error('静默模式返回坐标超出截图范围: x=' + localX + ', y=' + localY + ', 截图范围=' + sourceWidth + 'x' + sourceHeight);
  }

  var offsetX = rect ? Number(rect.x) || 0 : 0;
  var offsetY = rect ? Number(rect.y) || 0 : 0;
  var x = offsetX + localX - width / 2;
  var y = offsetY + localY - height / 2;
  var viewportWidth = Number(viewport && viewport.width) || sourceWidth + offsetX;
  var viewportHeight = Number(viewport && viewport.height) || sourceHeight + offsetY;

  x = Math.max(0, Math.min(x, viewportWidth - 1));
  y = Math.max(0, Math.min(y, viewportHeight - 1));
  width = Math.max(8, Math.min(width, viewportWidth - x));
  height = Math.max(8, Math.min(height, viewportHeight - y));

  return {
    questionNumber: String(parsed.questionNumber || parsed.question || parsed.index || ''),
    answer: String(answer),
    choice: String(choice || ''),
    raw: {
      x: rawX,
      y: rawY,
      width: rawWidth,
      height: rawHeight,
      unit: unit
    },
    target: {
      x: x,
      y: y,
      width: width,
      height: height
    }
  };
}

function normalizeSilentResult(rawAnswer, rect, viewport) {
  var parsed;
  try {
    parsed = JSON.parse(extractJsonObjectText(rawAnswer));
  } catch (error) {
    if (error.message && error.message.indexOf('静默模式') !== -1) throw error;
    throw new Error('静默模式返回内容不是有效 JSON，请检查提示词或响应模板: ' + (error.message || String(error)));
  }

  var rawItems = Array.isArray(parsed.items) ? parsed.items :
    (Array.isArray(parsed.questions) ? parsed.questions :
      (Array.isArray(parsed.targets) ? parsed.targets : [parsed]));
  var targets = rawItems.map(function (item) {
    return normalizeSilentTarget(item, rect, viewport);
  });
  if (targets.length === 0) {
    throw new Error('静默模式返回内容缺少 items');
  }
  var positionedTargets = targets.filter(function (item) {
    return item && item.target;
  });
  var clipboardItems = targets.filter(function (item) {
    return item && !item.target && String(item.answer || '').trim();
  });
  if (positionedTargets.length === 0 && clipboardItems.length === 0) {
    throw new Error('静默模式返回内容缺少可用答案');
  }
  var clipboardText = clipboardItems.map(function (item) {
    return (item.questionNumber ? item.questionNumber + ': ' : '') + item.answer;
  }).join('\n');

  return {
    mode: 'silent',
    answer: targets.map(function (item) {
      return (item.questionNumber ? item.questionNumber + ': ' : '') + item.answer;
    }).join('\n'),
    clipboardText: clipboardText,
    targets: positionedTargets,
    target: positionedTargets[0] || null
  };
}

/**
 * 从全屏截图中裁剪指定区域
 * @param {string} dataUrl - 全屏截图 data URL
 * @param {{x: number, y: number, width: number, height: number, dpr: number}} rect - 裁剪区域（CSS 像素 + devicePixelRatio）
 * @returns {Promise<string>} 裁剪后的 data URL（JPEG）
 */
async function cropImage(dataUrl, rect) {
  var resp = await fetch(dataUrl);
  var blob = await resp.blob();
  var img = await createImageBitmap(blob);

  // CSS 像素坐标乘以 devicePixelRatio 转换为物理像素
  var dpr = rect.dpr || 1;
  var sx = Math.round(rect.x * dpr);
  var sy = Math.round(rect.y * dpr);
  var sw = Math.round(rect.width * dpr);
  var sh = Math.round(rect.height * dpr);

  // 边界裁剪，防止超出图片范围
  if (sx < 0) { sw += sx; sx = 0; }
  if (sy < 0) { sh += sy; sy = 0; }
  if (sx + sw > img.width) { sw = img.width - sx; }
  if (sy + sh > img.height) { sh = img.height - sy; }
  if (sw <= 0 || sh <= 0) {
    throw new Error('选区超出图片范围');
  }

  var canvas = new OffscreenCanvas(sw, sh);
  var ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  var croppedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onloadend = function () { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(croppedBlob);
  });
}

/**
 * 截图 → AI 识别的完整流程
 * @param {number} windowId - 浏览器窗口 ID，用于 captureVisibleTab
 * @param {number} tabId - 标签页 ID，用于向 content script 发送状态
 * @param {{x:number,y:number,width:number,height:number,dpr:number}} [rect] - 可选裁剪区域
 * @returns {Promise<string>} AI 返回的答案文本
 */
async function captureAndAnalyze(windowId, tabId, rect, viewport) {
  // 取消上一次进行中的请求（模型接口卡住时，用户重新点击可触发取消）
  if (currentAbortController) {
    currentAbortController.abort();
  }
  currentAbortController = new AbortController();
  var signal = currentAbortController.signal;

  try {
    // 1. 截图：必须先 await sendStatus，等 content script 隐藏面板后再截图
    await sendStatus(tabId, '截图中...');
    var dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 90 });

    // 1.5 如果指定了裁剪区域，裁剪图片
    if (rect) {
      sendStatus(tabId, '裁剪中...');
      dataUrl = await cropImage(dataUrl, rect);
    }

    // 2. 调用视觉大模型进行识别
    sendStatus(tabId, 'AI识别中...');
    const settings = await chrome.storage.local.get(['customPrompt', 'silentPrompt', 'silentModeEnabled']);
    const silentModeEnabled = settings.silentModeEnabled === true;
    const prompt = silentModeEnabled ? buildSilentPrompt(settings.silentPrompt, rect, viewport) : settings.customPrompt;
    const answer = await queryAI(dataUrl, prompt, signal);

    sendStatus(tabId, '识别完成');
    return silentModeEnabled ? normalizeSilentResult(answer, rect, viewport) : answer;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('已取消');
    }
    throw error;
  } finally {
    if (currentAbortController && currentAbortController.signal === signal) {
      currentAbortController = null;
    }
  }
}

/**
 * 向 content script 发送实时状态消息（静默处理连接错误）
 */
function sendStatus(tabId, message) {
  return chrome.tabs.sendMessage(tabId, { action: 'status', message }).catch(() => {});
}

// 监听 content script 发起的截图识别请求
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'captureAndAnalyze') {
    captureAndAnalyze(sender.tab.windowId, sender.tab.id, null, request.viewport)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => {
        sendResponse({ success: false, error: error.message || String(error) });
      });
    return true; // 异步响应：保持 sendResponse 可用直到被调用
  }

  // 区域识别请求：带裁剪坐标
  if (request.action === 'captureAndAnalyzeWithRect') {
    captureAndAnalyze(sender.tab.windowId, sender.tab.id, request.rect, request.viewport)
      .then(function (result) { sendResponse({ success: true, result: result }); })
      .catch(function (error) {
        sendResponse({ success: false, error: error.message || String(error) });
      });
    return true;
  }

  if (request.action === 'cancelCapture') {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    if (sender.tab && sender.tab.id) {
      sendStatus(sender.tab.id, '已取消');
    }
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'switchConfigFromShortcut') {
    return asyncHandler(async function () {
      var config = await switchActiveConfigFromCommand();
      await notifyConfigSwitched(config);
      return { success: true, configName: config.name || '未命名配置' };
    })(request, sender, sendResponse);
  }

  // ====== 配置管理操作 ======

  if (request.action === 'checkApiHostPermission') {
    return asyncHandler(function (req) {
      return checkApiHostPermission(req.url).then(function (status) {
        return { success: true, origin: status.origin, granted: status.granted };
      });
    })(request, sender, sendResponse);
  }

  if (request.action === 'getConfigs') {
    chrome.storage.local.get('configList').then(data => {
      sendResponse({ success: true, configList: data.configList || [] });
    });
    return true;
  }

  if (request.action === 'exportSettings') {
    return asyncHandler(async function () {
      var data = await chrome.storage.local.get(['configList', 'customPrompt', 'silentPrompt', 'uiOpacity', 'silentModeEnabled', 'silentScrollPixels', 'silentDebugFrameEnabled']);
      var backup = ExamPilotSettingsTransfer.createSettingsBackup({
        configList: data.configList || [],
        customPrompt: data.customPrompt || '',
        silentPrompt: data.silentPrompt || DEFAULT_SILENT_PROMPT,
        uiOpacity: data.uiOpacity === undefined ? 0.95 : data.uiOpacity,
        silentModeEnabled: data.silentModeEnabled === true,
        silentScrollPixels: normalizeSilentScrollPixels(data.silentScrollPixels),
        silentDebugFrameEnabled: data.silentDebugFrameEnabled === true
      });
      return { success: true, backup: backup };
    })(request, sender, sendResponse);
  }

  if (request.action === 'importSettings') {
    return asyncHandler(async function (req) {
      var settings = ExamPilotSettingsTransfer.normalizeSettingsBackup(req.backup);
      await chrome.storage.local.set(settings);
      return { success: true, configCount: settings.configList.length };
    })(request, sender, sendResponse);
  }

  if (request.action === 'setActiveConfig') {
    return asyncHandler(async function (req) {
      const { configList = [] } = await chrome.storage.local.get('configList');
      configList.forEach(function (c) { c.selected = (c.id === req.configId); });
      await chrome.storage.local.set({ configList });
      return { success: true };
    })(request, sender, sendResponse);
  }

  if (request.action === 'addConfig') {
    return asyncHandler(async function (req) {
      const { configList = [] } = await chrome.storage.local.get('configList');
      configList.forEach(function (c) { c.selected = false; });
      configList.push({
        name: req.config.name,
        url: req.config.url,
        model: req.config.model,
        apiKey: req.config.apiKey,
        apiMode: req.config.apiMode || 'chat-completions',
        customHeadersJson: req.config.customHeadersJson || '',
        customBodyJson: req.config.customBodyJson || '',
        templateHeadersJson: req.config.templateHeadersJson || '',
        templateBodyJson: req.config.templateBodyJson || '',
        templateResponseText: req.config.templateResponseText || '',
        selected: true,
        id: 'cfg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
      });
      await chrome.storage.local.set({ configList });
      return { success: true };
    })(request, sender, sendResponse);
  }

  if (request.action === 'deleteConfig') {
    return asyncHandler(async function (req) {
      const { configList = [] } = await chrome.storage.local.get('configList');
      var deletedWasSelected = false;
      var idx = -1;
      configList.forEach(function (c, i) {
        if (c.id === req.configId) {
          deletedWasSelected = c.selected;
          idx = i;
        }
      });
      if (idx === -1) {
        return { success: false, error: '配置未找到' };
      }
      configList.splice(idx, 1);
      if (deletedWasSelected && configList.length > 0) {
        configList[0].selected = true;
      }
      await chrome.storage.local.set({ configList });
      return { success: true, configList: configList };
    })(request, sender, sendResponse);
  }

  if (request.action === 'getConfig') {
    return asyncHandler(async function (req) {
      const { configList = [] } = await chrome.storage.local.get('configList');
      var found = configList.find(function (c) { return c.id === req.configId; });
      if (found) {
        var result = Object.assign({}, found, {
          apiMode: found.apiMode || 'chat-completions',
          customHeadersJson: found.customHeadersJson || '',
          customBodyJson: found.customBodyJson || '',
          templateHeadersJson: found.templateHeadersJson || '',
          templateBodyJson: found.templateBodyJson || '',
          templateResponseText: found.templateResponseText || ''
        });
        return { success: true, config: result };
      }
      return { success: false, config: null };
    })(request, sender, sendResponse);
  }

  if (request.action === 'getPrompt') {
    chrome.storage.local.get(['customPrompt', 'silentPrompt']).then(function (data) {
      sendResponse({
        success: true,
        prompt: data.customPrompt || '',
        silentPrompt: data.silentPrompt || DEFAULT_SILENT_PROMPT
      });
    });
    return true;
  }

  if (request.action === 'setPrompt') {
    chrome.storage.local.set({ customPrompt: request.prompt }).then(function () {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'setSilentPrompt') {
    chrome.storage.local.set({ silentPrompt: request.prompt }).then(function () {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'getSilentMode') {
    chrome.storage.local.get(['silentModeEnabled', 'silentScrollPixels', 'silentDebugFrameEnabled']).then(function (data) {
      sendResponse({
        success: true,
        silentModeEnabled: data.silentModeEnabled === true,
        silentScrollPixels: normalizeSilentScrollPixels(data.silentScrollPixels),
        silentDebugFrameEnabled: data.silentDebugFrameEnabled === true
      });
    });
    return true;
  }

  if (request.action === 'setSilentMode') {
    chrome.storage.local.set({ silentModeEnabled: request.silentModeEnabled === true }).then(function () {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'setSilentScrollPixels') {
    chrome.storage.local.set({
      silentScrollPixels: normalizeSilentScrollPixels(request.silentScrollPixels)
    }).then(function () {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'setSilentDebugFrame') {
    chrome.storage.local.set({
      silentDebugFrameEnabled: request.silentDebugFrameEnabled === true
    }).then(function () {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'editConfig') {
    return asyncHandler(async function (req) {
      const { configList = [] } = await chrome.storage.local.get('configList');
      var target = configList.find(function (c) { return c.id === req.configId; });
      if (!target) {
        return { success: false, error: '配置未找到' };
      }
      target.name = req.config.name;
      target.url = req.config.url;
      target.model = req.config.model;
      target.apiKey = req.config.apiKey;
      target.apiMode = req.config.apiMode || 'chat-completions';
      target.customHeadersJson = req.config.customHeadersJson || '';
      target.customBodyJson = req.config.customBodyJson || '';
      target.templateHeadersJson = req.config.templateHeadersJson || '';
      target.templateBodyJson = req.config.templateBodyJson || '';
      target.templateResponseText = req.config.templateResponseText || '';
      await chrome.storage.local.set({ configList });
      return { success: true };
    })(request, sender, sendResponse);
  }
});
