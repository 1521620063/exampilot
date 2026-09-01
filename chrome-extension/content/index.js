/**
 * ExamPilot content script entry point
 *
 * Creates and mounts the Preact+htm panel with Shadow DOM isolation.
 */
/**
 * 内容脚本入口：负责挂载悬浮面板（Shadow DOM 隔离）、监听后台消息
 * （ping / 快捷键截图 / 清除结果 / 切换面板）与页面内兜底快捷键，
 * 并通过宿主元素上的 CustomEvent 将命令转发给面板组件。
 */

import { mountPanel } from './ui.js';

var IS_FULL_ACCESS = __EXAMPILOT_FULL_ACCESS__;
var epHost;
var pendingPanelCommands = [];

// 获取面板宿主元素（优先按 id 查找，其次取全局缓存引用）
function getPanelHost() {
  return document.getElementById('exmp-container') || window.__exampilotHost;
}

// 向面板宿主派发一条命令（CustomEvent），宿主不存在则返回 false
function runPanelCommand(command) {
  var host = getPanelHost();
  if (!host) return false;
  host.dispatchEvent(new CustomEvent(command.action, { detail: command.detail || {} }));
  return true;
}

// 面板就绪后，按序执行积压的面板命令
function flushPendingPanelCommands() {
  if (!window.__exampilotPanelReady) return;
  while (pendingPanelCommands.length > 0) {
    runPanelCommand(pendingPanelCommands.shift());
  }
}

// 派发面板命令；面板未就绪时先入队，待挂载完成后再补发
function dispatchPanelCommand(action, detail) {
  var command = { action: action, detail: detail || {} };

  function dispatch() {
    if (!runPanelCommand(command)) {
      pendingPanelCommands.push(command);
    }
  }

  if (window.__exampilotPanelReady) {
    dispatch();
    return;
  }

  pendingPanelCommands.push(command);
  var host = getPanelHost();
  if (host) {
    host.addEventListener('exampilot-panel-ready', flushPendingPanelCommands, { once: true });
  } else {
    document.addEventListener('exampilot-panel-mounted', flushPendingPanelCommands, { once: true });
  }
}

function dispatchCaptureCommand(mode) {
  dispatchPanelCommand('start-capture', { mode: mode });
}

// 创建并挂载面板宿主元素；若面板已存在则仅隐藏（避免重复挂载）
function createUI() {
  epHost = document.getElementById('exmp-container');
  if (window.__exampilotMounted && epHost) {
    window.__exampilotHost = epHost;
    epHost.dispatchEvent(new CustomEvent('hide-panel'));
    return;
  }

  if (epHost) {
    epHost.remove();
  }

  epHost = document.createElement('div');
  epHost.id = 'exmp-container';
  epHost.style.display = 'none';
  mountPanel(epHost);
  document.body.appendChild(epHost);
  window.__exampilotHost = epHost;
  window.__exampilotMounted = true;
  document.dispatchEvent(new CustomEvent('exampilot-panel-mounted'));
  flushPendingPanelCommands();
}

// 后台快捷键先用 ping 判断是否已注入；实际截图动作由面板复用按钮逻辑执行。
if (!window.__exampilotRuntimeHandlerAttached) {
  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === 'exampilotPing') {
      sendResponse({ success: true });
      return;
    }

    if (request.action === 'startCaptureFromCommand') {
      if (!window.__exampilotMounted) {
        createUI();
      }
      dispatchCaptureCommand(request.mode);
      sendResponse({ success: true });
      return;
    }

    if (request.action === 'clearResultsFromCommand') {
      if (!window.__exampilotMounted) {
        createUI();
      }
      dispatchPanelCommand('clear-results');
      sendResponse({ success: true });
      return;
    }

    if (request.action === 'togglePanelFromAction') {
      if (!window.__exampilotMounted) {
        createUI();
      }
      dispatchPanelCommand('toggle-panel');
      sendResponse({ success: true });
    }
  });
  window.__exampilotRuntimeHandlerAttached = true;
}

// 判断是否为 ExamPilot 页面内快捷键：Ctrl+Shift+1~4
function isExampilotShortcutEvent(e) {
  var key = e.key || '';
  var isNumberKey = key === '1' || key === '2' || key === '3' || key === '4';
  if (!isNumberKey || !e.shiftKey || e.altKey || e.metaKey) return false;
  return e.ctrlKey;
}

// 页面内兜底快捷键：扩展级 commands 被系统/Chrome 占用时，面板注入后仍可使用。
if (!window.__exampilotPageShortcutHandlerAttached) {
  document.addEventListener('keydown', function (e) {
    if (!isExampilotShortcutEvent(e)) return;

    e.preventDefault();
    e.stopPropagation();

    if (!window.__exampilotMounted) {
      createUI();
    }

    if (e.key === '1') {
      dispatchCaptureCommand('fullscreen');
      return;
    }

    if (e.key === '2') {
      dispatchCaptureCommand('region');
      return;
    }

    if (e.key === '3') {
      chrome.runtime.sendMessage({ action: 'switchConfigFromShortcut' }).catch(function () {});
      return;
    }

    if (e.key === '4') {
      dispatchPanelCommand('clear-results');
    }
  }, true);
  window.__exampilotPageShortcutHandlerAttached = true;
}

// 双击页面空白处切换面板显示/隐藏
if (!window.__exampilotToggleHandlerAttached) {
  document.addEventListener('dblclick', function () {
    var host = document.getElementById('exmp-container') || window.__exampilotHost;
    if (!host) return;
    host.dispatchEvent(new CustomEvent('toggle-panel'));
  });
  window.__exampilotToggleHandlerAttached = true;
}

// 等待 DOM 就绪后再挂载隐藏面板（document_start 阶段 body 可能尚不存在）
function createHiddenUIWhenReady() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createUI, { once: true });
  } else {
    createUI();
  }
}

// Full Access 版进入页面时自动挂载隐藏面板；普通版只在后台注入后挂载隐藏面板。
createHiddenUIWhenReady();

if (!IS_FULL_ACCESS && window.__exampilotMounted) {
  var injectedHost = getPanelHost();
  if (injectedHost) {
    injectedHost.style.display = 'none';
  }
}
