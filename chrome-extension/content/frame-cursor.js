/**
 * Relays pointer coordinates from nested frames to the top document.
 * Each frame hides its native cursor while silent mode is active; only the
 * top document renders the fake cursor.
 */
/**
 * 静默模式下的跨 frame 仿光标桥接：
 * 每个 frame 注入此脚本后隐藏自身原生光标，仅顶层页面渲染一个仿光标；
 * 子 frame 通过 postMessage 逐级上报指针坐标，父级换算成自身视口坐标
 * 后继续转发，直到顶层收到 'top-move' 消息并移动仿光标。
 */

var FRAME_CURSOR_MESSAGE = '__exampilotFrameCursor';

// 防止重复注入（all_frames 下同一 frame 可能执行多次）
if (!window.__exampilotFrameCursorBridgeAttached) {
  window.__exampilotFrameCursorBridgeAttached = true;

  var frameCursorEnabled = false;
  var frameCursorStyle = document.createElement('style');
  frameCursorStyle.setAttribute('data-exampilot-frame-cursor', '');

  // 静默模式开启且当前为子 frame 时，用 CSS 隐藏本 frame 内的原生光标
  function applyFrameCursorState() {
    frameCursorStyle.textContent = frameCursorEnabled && window !== window.top
      ? 'html, html * { cursor: none !important; }'
      : '';
  }

  function ensureFrameCursorStyleMounted() {
    var parent = document.head || document.documentElement;
    if (parent && !frameCursorStyle.parentNode) parent.appendChild(frameCursorStyle);
  }

  // 子 frame 向父级上报自身视口内的指针坐标
  function forwardFrameCursorPoint(clientX, clientY) {
    if (window === window.top) return;
    window.parent.postMessage({
      source: FRAME_CURSOR_MESSAGE,
      type: 'move',
      clientX: clientX,
      clientY: clientY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    }, '*');
  }

  // 遍历本页所有 frame，找出消息来源对应的 frame 元素（跨域下仍可用身份比较）
  function findSourceFrame(sourceWindow) {
    var frames = document.querySelectorAll('iframe, frame');
    for (var i = 0; i < frames.length; i += 1) {
      try {
        if (frames[i].contentWindow === sourceWindow) return frames[i];
      } catch (error) {
        // Cross-origin WindowProxy identity checks are allowed; ignore removed frames.
      }
    }
    return null;
  }

  // 坐标换算：把子 frame 视口坐标映射为父页面视口坐标。
  // 需叠加 frame 在父页面中的偏移、边框宽度，以及 CSS 缩放
  // （offsetWidth 与实际渲染宽度之比）和 frame 内部视口与显示区域的缩放比。
  function translateFramePoint(frame, data) {
    var rect = frame.getBoundingClientRect();
    var viewportWidth = Number(data.viewportWidth) || frame.clientWidth || rect.width;
    var viewportHeight = Number(data.viewportHeight) || frame.clientHeight || rect.height;
    var renderedScaleX = frame.offsetWidth > 0 ? rect.width / frame.offsetWidth : 1;
    var renderedScaleY = frame.offsetHeight > 0 ? rect.height / frame.offsetHeight : 1;
    var contentWidth = (frame.clientWidth || rect.width) * renderedScaleX;
    var contentHeight = (frame.clientHeight || rect.height) * renderedScaleY;
    var scaleX = viewportWidth > 0 ? contentWidth / viewportWidth : 1;
    var scaleY = viewportHeight > 0 ? contentHeight / viewportHeight : 1;
    return {
      clientX: rect.left + frame.clientLeft * renderedScaleX + Number(data.clientX) * scaleX,
      clientY: rect.top + frame.clientTop * renderedScaleY + Number(data.clientY) * scaleY
    };
  }

  // 处理子 frame 上报的坐标：顶层换算后广播 'top-move'，中间层继续向上转发
  function handleChildFrameMessage(event) {
    var data = event.data;
    if (!frameCursorEnabled || !data || data.source !== FRAME_CURSOR_MESSAGE || data.type !== 'move') return;
    var frame = findSourceFrame(event.source);
    if (!frame) return;
    var point = translateFramePoint(frame, data);

    if (window === window.top) {
      window.postMessage({
        source: FRAME_CURSOR_MESSAGE,
        type: 'top-move',
        clientX: point.clientX,
        clientY: point.clientY
      }, '*');
      return;
    }

    forwardFrameCursorPoint(point.clientX, point.clientY);
  }

  ensureFrameCursorStyleMounted();
  applyFrameCursorState();

  // 本 frame 内鼠标移动时向父级上报坐标（捕获阶段，避免被页面拦截）
  document.addEventListener('mousemove', function (event) {
    if (!frameCursorEnabled) return;
    forwardFrameCursorPoint(event.clientX, event.clientY);
  }, true);
  window.addEventListener('message', handleChildFrameMessage, true);

  // 初始化时读取静默模式开关
  chrome.storage.local.get('silentModeEnabled').then(function (data) {
    frameCursorEnabled = data.silentModeEnabled === true;
    ensureFrameCursorStyleMounted();
    applyFrameCursorState();
  }).catch(function () {});

  // 跟随静默模式开关变化，实时启用/停用本 frame 的光标隐藏与坐标上报
  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName !== 'local' || !changes.silentModeEnabled) return;
    frameCursorEnabled = changes.silentModeEnabled.newValue === true;
    ensureFrameCursorStyleMounted();
    applyFrameCursorState();
  });
}
