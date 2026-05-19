/**
 * ExamPilot content script entry point
 *
 * Creates and mounts the Preact+htm panel with Shadow DOM isolation.
 */

import { mountPanel } from './ui.js';

var epHost;

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
