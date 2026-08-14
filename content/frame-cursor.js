/**
 * Relays pointer coordinates from nested frames to the top document.
 * Each frame hides its native cursor while silent mode is active; only the
 * top document renders the fake cursor.
 */

var FRAME_CURSOR_MESSAGE = '__exampilotFrameCursor';

if (!window.__exampilotFrameCursorBridgeAttached) {
  window.__exampilotFrameCursorBridgeAttached = true;

  var frameCursorEnabled = false;
  var frameCursorStyle = document.createElement('style');
  frameCursorStyle.setAttribute('data-exampilot-frame-cursor', '');

  function applyFrameCursorState() {
    frameCursorStyle.textContent = frameCursorEnabled && window !== window.top
      ? 'html, html * { cursor: none !important; }'
      : '';
  }

  function ensureFrameCursorStyleMounted() {
    var parent = document.head || document.documentElement;
    if (parent && !frameCursorStyle.parentNode) parent.appendChild(frameCursorStyle);
  }

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

  function translateFramePoint(frame, data) {
    var rect = frame.getBoundingClientRect();
    var viewportWidth = Number(data.viewportWidth) || frame.clientWidth || rect.width;
    var viewportHeight = Number(data.viewportHeight) || frame.clientHeight || rect.height;
    var contentWidth = frame.clientWidth || rect.width;
    var contentHeight = frame.clientHeight || rect.height;
    var scaleX = viewportWidth > 0 ? contentWidth / viewportWidth : 1;
    var scaleY = viewportHeight > 0 ? contentHeight / viewportHeight : 1;
    return {
      clientX: rect.left + frame.clientLeft + Number(data.clientX) * scaleX,
      clientY: rect.top + frame.clientTop + Number(data.clientY) * scaleY
    };
  }

  function handleChildFrameMessage(event) {
    var data = event.data;
    if (!data || data.source !== FRAME_CURSOR_MESSAGE || data.type !== 'move') return;
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

  document.addEventListener('mousemove', function (event) {
    if (!frameCursorEnabled) return;
    forwardFrameCursorPoint(event.clientX, event.clientY);
  }, true);
  window.addEventListener('message', handleChildFrameMessage, true);

  chrome.storage.local.get('silentModeEnabled').then(function (data) {
    frameCursorEnabled = data.silentModeEnabled === true;
    ensureFrameCursorStyleMounted();
    applyFrameCursorState();
  }).catch(function () {});

  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName !== 'local' || !changes.silentModeEnabled) return;
    frameCursorEnabled = changes.silentModeEnabled.newValue === true;
    ensureFrameCursorStyleMounted();
    applyFrameCursorState();
  });
}
