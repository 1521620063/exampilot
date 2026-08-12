/**
 * ExamPilot content script entry point
 *
 * Creates and mounts the Preact+htm panel with Shadow DOM isolation.
 */

import { mountPanel } from './ui.js';

var epHost;

function dispatchPanelCommand(action, detail) {
  function dispatch() {
    var host = document.getElementById('exmp-container') || window.__exampilotHost;
    if (!host) return;
    host.dispatchEvent(new CustomEvent(action, { detail: detail || {} }));
  }

  if (window.__exampilotPanelReady) {
    dispatch();
    return;
  }

  var host = document.getElementById('exmp-container') || window.__exampilotHost;
  if (host) {
    host.addEventListener('exampilot-panel-ready', dispatch, { once: true });
  } else {
    document.addEventListener('exampilot-panel-mounted', dispatch, { once: true });
  }
}

function dispatchCaptureCommand(mode) {
  dispatchPanelCommand('start-capture', { mode: mode });
}

function createUI() {
  epHost = document.getElementById('exmp-container');
  if (window.__exampilotMounted && epHost) {
    window.__exampilotHost = epHost;
    epHost.dispatchEvent(new CustomEvent('toggle-panel'));
    return;
  }

  if (epHost) {
    epHost.remove();
  }

  epHost = document.createElement('div');
  epHost.id = 'exmp-container';
  mountPanel(epHost);
  document.body.appendChild(epHost);
  window.__exampilotHost = epHost;
  window.__exampilotMounted = true;
  document.dispatchEvent(new CustomEvent('exampilot-panel-mounted'));
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
