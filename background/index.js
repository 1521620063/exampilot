// 加载配置、上传模块和 AI 查询模块（MV3 不支持 ES Module，用 importScripts 合并）
importScripts('../config.js', 'upload.js', 'query-ai.js');

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

/** 确保至少有一个 selected，否则选中第一个 */
function autoSelectFallback(list) {
  if (list.length > 0 && !list.some(function (c) { return c.selected; })) {
    list[0].selected = true;
  }
}

/** 获取当前选中的 AI 配置（供 query-ai.js 调用） */
async function getActiveConfig() {
  const { configList } = await chrome.storage.local.get('configList');
  if (configList && configList.length > 0) {
    var selected = configList.find(function (c) { return c.selected; });
    if (selected) {
      // 确保旧数据有默认 apiMode
      if (!selected.apiMode) {
        selected.apiMode = 'chat-completions';
      }
      return selected;
    }
    throw new Error('请先点击 ⚙️ 选择 AI 配置');
  }
  throw new Error('请先点击 ⚙️ 添加 AI 配置');
}

// 启动时初始化 / 迁移配置
ensureConfigInitialized();

/**
 * 截图 → 上传 OSS → AI 识别的完整流程
 * @param {number} windowId - 浏览器窗口 ID，用于 captureVisibleTab
 * @param {number} tabId - 标签页 ID，用于向 content script 发送状态
 * @returns {Promise<string>} AI 返回的答案文本
 */
async function captureAndAnalyze(windowId, tabId) {
  // 1. 截图：必须先 await sendStatus，等 content script 隐藏面板后再截图
  await sendStatus(tabId, '截图中...');
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 90 });

  let imageUrl = dataUrl;
  if (UPLOAD_MODE === 'oss') {
    // 2. 上传截图到阿里云 OSS，获取公开可访问的图片 URL
    sendStatus(tabId, '上传图片中...');
    imageUrl = await uploadToOSS(dataUrl);
  } else {
    sendStatus(tabId, '处理图片中...');
  }

  // 3. 调用视觉大模型进行识别
  sendStatus(tabId, 'AI识别中...');
  const answer = await queryAI(imageUrl);

  sendStatus(tabId, '识别完成');
  return answer;
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

  // ====== 配置管理操作 ======

  if (request.action === 'getConfigs') {
    chrome.storage.local.get('configList').then(data => {
      sendResponse({ success: true, configList: data.configList || [] });
    });
    return true;
  }

  if (request.action === 'setActiveConfig') {
    (async () => {
      const { configList } = await chrome.storage.local.get('configList');
      configList.forEach(function (c) { c.selected = (c.id === request.configId); });
      await chrome.storage.local.set({ configList });
      sendResponse({ success: true });
    })();
    return true;
  }

  if (request.action === 'addConfig') {
    (async () => {
      const { configList = [] } = await chrome.storage.local.get('configList');
      // 取消全部选中，新配置将作为当前使用
      configList.forEach(function (c) { c.selected = false; });
      configList.push({
        name: request.config.name,
        url: request.config.url,
        model: request.config.model,
        apiKey: request.config.apiKey,
        apiMode: request.config.apiMode || 'chat-completions',
        selected: true,
        id: 'cfg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
      });
      await chrome.storage.local.set({ configList });
      sendResponse({ success: true });
    })();
    return true;
  }

  if (request.action === 'deleteConfig') {
    (async () => {
      const { configList } = await chrome.storage.local.get('configList');
      var deletedWasSelected = false;
      var idx = -1;
      configList.forEach(function (c, i) {
        if (c.id === request.configId) {
          deletedWasSelected = c.selected;
          idx = i;
        }
      });
      if (idx === -1) {
        sendResponse({ success: false, error: '配置未找到' });
        return;
      }
      configList.splice(idx, 1);
      if (deletedWasSelected && configList.length > 0) {
        configList[0].selected = true;
      }
      await chrome.storage.local.set({ configList });
      sendResponse({ success: true, configList: configList });
    })();
    return true;
  }

  if (request.action === 'getConfig') {
    (async () => {
      const { configList } = await chrome.storage.local.get('configList');
      var found = configList.find(function (c) { return c.id === request.configId; });
      if (found) {
        // 为旧数据提供默认值
        var result = Object.assign({}, found, { apiMode: found.apiMode || 'chat-completions' });
        sendResponse({ success: true, config: result });
      } else {
        sendResponse({ success: false, config: null });
      }
    })();
    return true;
  }

  if (request.action === 'editConfig') {
    (async () => {
      const { configList } = await chrome.storage.local.get('configList');
      var target = configList.find(function (c) { return c.id === request.configId; });
      if (!target) {
        sendResponse({ success: false, error: '配置未找到' });
        return;
      }
      target.name = request.config.name;
      target.url = request.config.url;
      target.model = request.config.model;
      target.apiKey = request.config.apiKey;
      target.apiMode = request.config.apiMode || 'chat-completions';
      await chrome.storage.local.set({ configList });
      sendResponse({ success: true });
    })();
    return true;
  }
});
