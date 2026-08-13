/**
 * ExamPilot content script entry point
 *
 * Creates and mounts the Preact+htm panel with Shadow DOM isolation.
 */

import { mountPanel } from './ui.js';

var epHost;
var pendingPanelCommands = [];

function getPanelHost() {
  return document.getElementById('exmp-container') || window.__exampilotHost;
}

function runPanelCommand(command) {
  var host = getPanelHost();
  if (!host) return false;
  host.dispatchEvent(new CustomEvent(command.action, { detail: command.detail || {} }));
  return true;
}

function flushPendingPanelCommands() {
  if (!window.__exampilotPanelReady) return;
  while (pendingPanelCommands.length > 0) {
    runPanelCommand(pendingPanelCommands.shift());
  }
}

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
    }
  });
  window.__exampilotRuntimeHandlerAttached = true;
}

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

// 确保 DOM 加载完成后再初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createUI);
} else {
  createUI();
}
