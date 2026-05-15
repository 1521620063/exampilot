/**
 * ExamPilot content script entry point
 *
 * Creates and mounts the Preact+htm panel with Shadow DOM isolation.
 */

import { mountPanel } from './ui.js';

var epHost;

function createUI() {
  epHost = document.createElement('div');
  epHost.id = 'exmp-container';
  mountPanel(epHost);
  document.body.appendChild(epHost);
}

// 双击页面空白处切换面板显示/隐藏
document.addEventListener('dblclick', function () {
  if (!epHost) return;
  epHost.dispatchEvent(new CustomEvent('toggle-panel'));
});

// 确保 DOM 加载完成后再初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createUI);
} else {
  createUI();
}
