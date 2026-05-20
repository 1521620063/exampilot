// 加载配置、请求覆盖和 AI 查询模块（MV3 不支持 ES Module，用 importScripts 合并）
importScripts('request-overrides.js', 'query-ai.js');

var currentAbortController = null;

// 点击扩展图标时注入内容脚本（activeTab 策略，不再需要 <all_urls> 权限）
chrome.action.onClicked.addListener(function (tab) {
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content/bundle/content-bundle.js']
  }).catch(function (err) {
    console.error('注入内容脚本失败:', err);
  });
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
  const { customPrompt } = await chrome.storage.local.get('customPrompt');
  if (customPrompt !== undefined) return;
  await chrome.storage.local.set({
    customPrompt: '解析图片中的内容。\n\n如果图片中有题目：\n请识别题目并解答。\n\n严格按照下面格式输出：\n\n题目："xxx"\n\n<br/>\n\n<b>答案："xxx"</b>\n\n不要输出多余内容。'
  });
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
  var permission = { origins: [origin] };
  var granted = await chrome.permissions.contains(permission);
  return { origin: origin, granted: granted };
}

/**
 * 网络请求前只做检查，不在异步流程里申请权限。
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
async function captureAndAnalyze(windowId, tabId, rect) {
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
    const { customPrompt } = await chrome.storage.local.get('customPrompt');
    const answer = await queryAI(dataUrl, customPrompt, signal);

    sendStatus(tabId, '识别完成');
    return answer;
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
    captureAndAnalyze(sender.tab.windowId, sender.tab.id)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => {
        sendResponse({ success: false, error: error.message || String(error) });
      });
    return true; // 异步响应：保持 sendResponse 可用直到被调用
  }

  // 区域识别请求：带裁剪坐标
  if (request.action === 'captureAndAnalyzeWithRect') {
    captureAndAnalyze(sender.tab.windowId, sender.tab.id, request.rect)
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
          customBodyJson: found.customBodyJson || ''
        });
        return { success: true, config: result };
      }
      return { success: false, config: null };
    })(request, sender, sendResponse);
  }

  if (request.action === 'getPrompt') {
    chrome.storage.local.get('customPrompt').then(function (data) {
      sendResponse({ success: true, prompt: data.customPrompt || '' });
    });
    return true;
  }

  if (request.action === 'setPrompt') {
    chrome.storage.local.set({ customPrompt: request.prompt }).then(function () {
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
      await chrome.storage.local.set({ configList });
      return { success: true };
    })(request, sender, sendResponse);
  }
});
