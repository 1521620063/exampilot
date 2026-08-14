/**
 * ExamPilot Floating Panel — Preact + htm with Shadow DOM
 *
 * Shadow DOM via attachShadow() on a plain <div> (no custom elements).
 * No JSX transform needed — htm provides tagged template syntax.
 */

import { render, h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import '../background/template-engine.js';
import {
  DEFAULT_UI_OPACITY,
  applyUiOpacity
} from './ui-opacity.js';

const html = htm.bind(h);
var IS_FULL_ACCESS = __EXAMPILOT_FULL_ACCESS__;
var __permissionHandler = null;
var __permissionRequest = null;
var DEFAULT_FAKE_CURSOR_SIZE = 14;
var DEFAULT_FAKE_CURSOR_STYLE = 'dark-outline';
var DEFAULT_SILENT_PROMPT = '请识别图片中所有完整显示的题目。只返回一个 JSON 对象，不要使用 Markdown 代码块，不要输出多余文字。\n' +
  '不要定位到题干空白、横线、输入框、解析区域或未完整显示的题目。\n' +
  '选择题必须返回正确选项本身的位置：bboxPercent 要框住正确选项行，至少包含选项字母圆圈和选项文本；coordinatePercent 要落在这个 bboxPercent 内。\n' +
  '简答题、填空题、编程题等没有可悬浮正确选项的题目，不要编造坐标，只返回答案文本，并设置 "clipboardOnly": true。\n' +
  '如果编程题已经给定了部分代码、函数签名、类定义、输入输出处理或注释要求，请在已有内容基础上补全，不要重写无关结构，不要删除题目给定的代码。\n' +
  'JSON 格式必须为：{"items":[{"questionNumber":"题号","answer":"正确答案文本","choice":"A/B/C/D 等选项字母","coordinatePercent":{"x":0到1的小数,"y":0到1的小数},"bboxPercent":{"x":0到1的小数,"y":0到1的小数,"width":0到1的小数,"height":0到1的小数}},{"questionNumber":"题号","answer":"简答/编程题答案文本","clipboardOnly":true}]}';

function getApiUrlPlaceholder(apiMode) {
  var placeholders = {
    'chat-completions': 'https://api.openai.com/v1/chat/completions',
    'responses-api': 'https://api.openai.com/v1/responses',
    'anthropic': 'https://api.anthropic.com/v1/messages',
    'custom-template': 'https://api.example.com/v1/analyze'
  };
  return placeholders[apiMode] || placeholders['chat-completions'];
}

function normalizeFakeCursorSize(value) {
  var number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_FAKE_CURSOR_SIZE;
  return Math.max(10, Math.min(Math.round(number), 32));
}

function normalizeFakeCursorStyle(value) {
  return value === 'light-outline' ? value : DEFAULT_FAKE_CURSOR_STYLE;
}

function sanitizeAnswerHtml(value) {
  var template = document.createElement('template');
  template.innerHTML = String(value || '');
  var allowedTags = {
    B: true,
    BR: true,
    STRONG: true,
    EM: true,
    I: true,
    U: true,
    P: true,
    DIV: true,
    SPAN: true,
    UL: true,
    OL: true,
    LI: true,
    CODE: true,
    PRE: true
  };
  var blockedTags = { SCRIPT: true, STYLE: true, IFRAME: true, OBJECT: true, EMBED: true };

  function clean(node) {
    var child = node.firstChild;
    while (child) {
      var next = child.nextSibling;
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (blockedTags[child.tagName]) {
          child.remove();
        } else if (!allowedTags[child.tagName]) {
          var text = document.createTextNode(child.textContent || '');
          child.replaceWith(text);
        } else {
          var attrs = Array.prototype.slice.call(child.attributes);
          attrs.forEach(function (attr) {
            child.removeAttribute(attr.name);
          });
          clean(child);
        }
      } else if (child.nodeType === Node.COMMENT_NODE) {
        child.remove();
      }
      child = next;
    }
  }

  clean(template.content);
  return template.innerHTML;
}

/**
 * Mount the ExamPilot panel into a host element with Shadow DOM isolation.
 * @param {HTMLElement} host - A plain <div> to attach shadow root to
 */
export function mountPanel(host) {
  var shadow = host.attachShadow({ mode: 'open' });

  function Panel() {
    // ---- State ----
    var _a = useState('mini'), viewState = _a[0], setViewState = _a[1];
    var _b = useState(''), statusText = _b[0], setStatusText = _b[1];
    var _c = useState(false), showSpinner = _c[0], setShowSpinner = _c[1];
    var _d = useState([]), answers = _d[0], setAnswers = _d[1];
    var _e = useState(false), capturing = _e[0], setCapturing = _e[1];
    var _f = useState([]), configList = _f[0], setConfigList = _f[1];
    var _g = useState(null), editingId = _g[0], setEditingId = _g[1];
    var _h = useState(false), showForm = _h[0], setShowForm = _h[1];
    var _i = useState(''), formName = _i[0], setFormName = _i[1];
    var _j = useState(''), formUrl = _j[0], setFormUrl = _j[1];
    var _k = useState(''), formModel = _k[0], setFormModel = _k[1];
    var _l = useState(''), formKey = _l[0], setFormKey = _l[1];
    var _m = useState('chat-completions'), formMode = _m[0], setFormMode = _m[1];
    var _n = useState(''), customPrompt = _n[0], setCustomPrompt = _n[1];
    var _o = useState(false), promptSaving = _o[0], setPromptSaving = _o[1];
    var silentPromptState = useState(''), silentPrompt = silentPromptState[0], setSilentPrompt = silentPromptState[1];
    var silentPromptSavingState = useState(false), silentPromptSaving = silentPromptSavingState[0], setSilentPromptSaving = silentPromptSavingState[1];
    var _p = useState(''), formHeadersJson = _p[0], setFormHeadersJson = _p[1];
    var _q = useState(''), formBodyJson = _q[0], setFormBodyJson = _q[1];
    var templateHeadersState = useState(''), formTemplateHeadersJson = templateHeadersState[0], setFormTemplateHeadersJson = templateHeadersState[1];
    var templateBodyState = useState(''), formTemplateBodyJson = templateBodyState[0], setFormTemplateBodyJson = templateBodyState[1];
    var templateResponseState = useState(''), formTemplateResponseText = templateResponseState[0], setFormTemplateResponseText = templateResponseState[1];
    var _r = useState(false), showHeadersSection = _r[0], setShowHeadersSection = _r[1];
    var _s = useState(false), showBodySection = _s[0], setShowBodySection = _s[1];
    var responseSectionState = useState(false), showResponseSection = responseSectionState[0], setShowResponseSection = responseSectionState[1];
    var _t = useState(false), showPreview = _t[0], setShowPreview = _t[1];
    var _u = useState(''), formError = _u[0], setFormError = _u[1];
    var _v = useState(false), configSaving = _v[0], setConfigSaving = _v[1];
    var opacityState = useState(DEFAULT_UI_OPACITY), uiOpacity = opacityState[0], setUiOpacity = opacityState[1];
    var fakeCursorSizeState = useState(DEFAULT_FAKE_CURSOR_SIZE), fakeCursorSize = fakeCursorSizeState[0], setFakeCursorSize = fakeCursorSizeState[1];
    var fakeCursorStyleState = useState(DEFAULT_FAKE_CURSOR_STYLE), fakeCursorStyle = fakeCursorStyleState[0], setFakeCursorStyle = fakeCursorStyleState[1];
    var silentModeState = useState(false), silentModeEnabled = silentModeState[0], setSilentModeEnabled = silentModeState[1];
    var silentDebugFrameState = useState(false), silentDebugFrameEnabled = silentDebugFrameState[0], setSilentDebugFrameEnabled = silentDebugFrameState[1];
    var transferBusyState = useState(false), transferBusy = transferBusyState[0], setTransferBusy = transferBusyState[1];
    var transferMessageState = useState(null), transferMessage = transferMessageState[0], setTransferMessage = transferMessageState[1];
    var positionState = useState(null), panelPosition = positionState[0], setPanelPosition = positionState[1];
    var hiddenByUserRef = useRef(host.style.display === 'none');
    var hiddenForCaptureRef = useRef(false);
    var currentRequestSeqRef = useRef(0);
    var miniDragRef = useRef(null);
    var suppressMiniClickRef = useRef(false);
    var importInputRef = useRef(null);
    var silentTargetRef = useRef(null);
    var silentHoverTimerRef = useRef(null);
    var silentHoverTargetRef = useRef(null);
    var silentActiveTargetRef = useRef(null);
    var silentMouseMoveHandlerRef = useRef(null);
    var silentModeEnabledRef = useRef(false);
    var silentDebugFrameEnabledRef = useRef(false);
    var fakeCursorRef = useRef(null);
    var fakeCursorSizeRef = useRef(DEFAULT_FAKE_CURSOR_SIZE);
    var fakeCursorStyleRef = useRef(DEFAULT_FAKE_CURSOR_STYLE);

    // 区域选择相关状态
    var _w = useState(false), selectingRegion = _w[0], setSelectingRegion = _w[1];
    var overlayElRef = useRef(null);

    silentModeEnabledRef.current = silentModeEnabled;
    silentDebugFrameEnabledRef.current = silentDebugFrameEnabled;
    fakeCursorSizeRef.current = fakeCursorSize;
    fakeCursorStyleRef.current = fakeCursorStyle;

    function handleCaptureResponse(response, mySeq) {
      if (mySeq !== currentRequestSeqRef.current) return;
      resumeFakeCursorAfterCapture();
      if (!response.success) {
        setStatusText('处理失败');
        setShowSpinner(false);
        setAnswers(function (prev) { return prev.concat([{ type: 'error', content: '❌ ' + (response.error || '未知错误') }]); });
      } else {
        setStatusText('识别完成');
        setShowSpinner(false);
        if (response.result && response.result.mode === 'silent') {
          // The mode may have been turned off while the AI request was in flight.
          if (!silentModeEnabledRef.current) {
            setStatusText('静默模式已关闭');
            return;
          }
          installSilentTarget(response.result);
          copySilentClipboardText(response.result.clipboardText).then(function (copied) {
            if (mySeq !== currentRequestSeqRef.current) return;
            if (copied) {
              setStatusText(response.result.targets && response.result.targets.length > 0 ? '静默模式已就绪，答案已复制' : '答案已复制到剪切板');
            } else if (response.result.clipboardText) {
              setStatusText('剪切板写入失败');
              setAnswers(function (prev) { return prev.concat([{ type: 'error', content: '❌ 浏览器阻止了自动复制，请检查剪切板权限' }]); });
            } else {
              setStatusText('静默模式已就绪');
            }
          });
          if (!response.result.clipboardText) {
            setStatusText('静默模式已就绪');
          }
          return;
        }
        setAnswers(function (prev) { return prev.concat([{ type: 'answer', content: response.result }]); });
      }
    }

    function handleCaptureError(error, mySeq) {
      if (mySeq !== currentRequestSeqRef.current) return;
      resumeFakeCursorAfterCapture();
      removeSilentTarget();
      setStatusText('处理失败');
      setShowSpinner(false);
      setAnswers(function (prev) { return prev.concat([{ type: 'error', content: '❌ ' + (error.message || String(error)) }]); });
    }

    function handleCaptureFinally(mySeq) {
      if (mySeq === currentRequestSeqRef.current) {
        resumeFakeCursorAfterCapture();
        setCapturing(false);
      }
    }

    function resumeFakeCursorAfterCapture() {
      var state = fakeCursorRef.current;
      if (!state) return;
      state.suspended = false;
      state.hasPointer = false;
      state.visible = false;
      if (state.cursor) state.cursor.style.setProperty('display', 'none', 'important');
    }

    // ---- Listen for status messages from background ----
    useEffect(function () {
      function handler(request) {
        if (request.action === 'status') {
          if (request.message === '截图中...') {
            host.style.display = 'none';
            hiddenForCaptureRef.current = true;
            var cursorState = fakeCursorRef.current;
            if (cursorState && cursorState.cursor) {
              resetSilentHoverState();
              cursorState.suspended = true;
              cursorState.hasPointer = false;
              cursorState.visible = false;
              cursorState.cursor.style.setProperty('display', 'none', 'important');
            }
          } else {
            var activeCursorState = fakeCursorRef.current;
            if (activeCursorState) activeCursorState.suspended = false;
            if (host.style.display === 'none' && hiddenForCaptureRef.current && !hiddenByUserRef.current) {
              host.style.display = '';
              hiddenForCaptureRef.current = false;
              setViewState('main');
            }
          }
          setStatusText(request.message || '');
          setShowSpinner(
            request.message.indexOf('...') !== -1 ||
            request.message.indexOf('中') !== -1
          );
          return;
        }

        if (request.action === 'activeConfigChanged') {
          setStatusText('已切换配置：' + (request.configName || '未命名配置'));
          setShowSpinner(false);
          loadConfigs();
        }
      }
      chrome.runtime.onMessage.addListener(handler);
      return function () { chrome.runtime.onMessage.removeListener(handler); };
    }, []);

    // ---- Draggable mini panel position ----
    function clampPositionRatio(value) {
      return Math.max(0, Math.min(Number(value), 1));
    }

    function getPositionBounds(width, height) {
      return {
        minLeft: 8,
        maxLeft: Math.max(8, window.innerWidth - width - 8),
        minTop: 8,
        maxTop: Math.max(8, window.innerHeight - height - 8)
      };
    }

    function positionFromPixels(left, top, width, height) {
      var bounds = getPositionBounds(width, height);
      var horizontalRange = bounds.maxLeft - bounds.minLeft;
      var verticalRange = bounds.maxTop - bounds.minTop;
      return {
        xRatio: horizontalRange > 0 ? clampPositionRatio((left - bounds.minLeft) / horizontalRange) : 0,
        yRatio: verticalRange > 0 ? clampPositionRatio((top - bounds.minTop) / verticalRange) : 0
      };
    }

    useEffect(function () {
      var active = true;
      chrome.storage.local.get('panelPosition').then(function (data) {
        var saved = data.panelPosition;
        if (!active || !saved) return;
        var savedXRatio = Number(saved.xRatio);
        var savedYRatio = Number(saved.yRatio);
        if (Number.isFinite(savedXRatio) && Number.isFinite(savedYRatio)) {
          setPanelPosition({
            xRatio: clampPositionRatio(savedXRatio),
            yRatio: clampPositionRatio(savedYRatio)
          });
          return;
        }

        var savedLeft = Number(saved.left);
        var savedTop = Number(saved.top);
        if (!Number.isFinite(savedLeft)) {
          if (saved.side !== 'left' && saved.side !== 'right') return;
          savedLeft = saved.side === 'left' ? 24 : window.innerWidth - 68;
        }
        var mini = shadow.querySelector('.exmp-mini');
        var miniRect = mini ? mini.getBoundingClientRect() : { width: 44, height: 44 };
        var migratedPosition = positionFromPixels(
          savedLeft,
          Number.isFinite(savedTop) ? savedTop : 8,
          miniRect.width,
          miniRect.height
        );
        setPanelPosition(migratedPosition);
        chrome.storage.local.set({ panelPosition: migratedPosition }).catch(function () {});
      }).catch(function () {});
      return function () { active = false; };
    }, []);

    function applySavedPosition(position) {
      var panel = shadow.querySelector('.exmp-panel, .exmp-mini');
      var width = panel ? panel.getBoundingClientRect().width : 44;
      var height = panel ? panel.getBoundingClientRect().height : 44;
      var bounds = getPositionBounds(width, height);
      var left = bounds.minLeft + clampPositionRatio(position.xRatio) * (bounds.maxLeft - bounds.minLeft);
      var top = bounds.minTop + clampPositionRatio(position.yRatio) * (bounds.maxTop - bounds.minTop);
      host.style.setProperty('--exmp-left', left + 'px');
      host.style.setProperty('--exmp-right', 'auto');
      host.style.setProperty('--exmp-top', top + 'px');
      host.style.setProperty('--exmp-bottom', 'auto');
      host.style.setProperty('--exmp-align-items', 'flex-start');
    }

    function applyDefaultPosition() {
      ['--exmp-top', '--exmp-bottom', '--exmp-left', '--exmp-right', '--exmp-align-items'].forEach(function (property) {
        host.style.removeProperty(property);
      });
    }

    useEffect(function () {
      if (!panelPosition) return;

      function updatePosition() {
        applySavedPosition(panelPosition);
      }

      var frame = 0;
      function schedulePositionUpdate() {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(updatePosition);
      }

      schedulePositionUpdate();
      window.addEventListener('resize', schedulePositionUpdate);

      var panel = shadow.querySelector('.exmp-panel, .exmp-mini');
      var resizeObserver = null;
      if (panel && window.ResizeObserver) {
        resizeObserver = new window.ResizeObserver(schedulePositionUpdate);
        resizeObserver.observe(panel);
      }

      return function () {
        cancelAnimationFrame(frame);
        window.removeEventListener('resize', schedulePositionUpdate);
        if (resizeObserver) resizeObserver.disconnect();
      };
    }, [panelPosition, viewState]);

    function handleMiniPointerDown(event) {
      if (event.button !== undefined && event.button !== 0) return;
      var rect = host.getBoundingClientRect();
      var miniRect = event.currentTarget.getBoundingClientRect();
      miniDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        width: miniRect.width,
        height: miniRect.height,
        dragged: false
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    function handleMiniPointerMove(event) {
      var drag = miniDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!drag.dragged && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
      drag.dragged = true;
      var bounds = getPositionBounds(drag.width, drag.height);
      var left = Math.max(bounds.minLeft, Math.min(event.clientX - drag.offsetX, bounds.maxLeft));
      var top = Math.max(bounds.minTop, Math.min(event.clientY - drag.offsetY, bounds.maxTop));
      host.style.setProperty('--exmp-left', left + 'px');
      host.style.setProperty('--exmp-right', 'auto');
      host.style.setProperty('--exmp-top', top + 'px');
      host.style.setProperty('--exmp-bottom', 'auto');
    }

    function handleMiniPointerUp(event) {
      var drag = miniDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      miniDragRef.current = null;
      if (!drag.dragged) return;

      var rect = host.getBoundingClientRect();
      var nextPosition = positionFromPixels(rect.left, rect.top, drag.width, drag.height);
      suppressMiniClickRef.current = true;
      setPanelPosition(nextPosition);
      chrome.storage.local.set({ panelPosition: nextPosition }).catch(function () {});
    }

    function handleMiniPointerCancel(event) {
      var drag = miniDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      miniDragRef.current = null;
      if (panelPosition) {
        applySavedPosition(panelPosition);
      } else {
        applyDefaultPosition();
      }
    }

    function handleMiniClick() {
      if (suppressMiniClickRef.current) {
        suppressMiniClickRef.current = false;
        return;
      }
      setViewState('main');
    }

    // ---- Global UI opacity preference ----
    useEffect(function () {
      var active = true;

      function updateOpacity(value) {
        if (!active) return;
        var normalized = applyUiOpacity(host, value);
        setUiOpacity(normalized);
      }

      chrome.storage.local.get('uiOpacity').then(function (data) {
        updateOpacity(data.uiOpacity);
      }).catch(function () {
        updateOpacity(DEFAULT_UI_OPACITY);
      });

      function storageHandler(changes, areaName) {
        if (areaName === 'local' && changes.uiOpacity) {
          updateOpacity(changes.uiOpacity.newValue);
        }
      }

      chrome.storage.onChanged.addListener(storageHandler);
      return function () {
        active = false;
        chrome.storage.onChanged.removeListener(storageHandler);
      };
    }, []);

    // ---- Global fake cursor preference ----
    useEffect(function () {
      var active = true;
      var style = document.createElement('style');
      style.textContent = '';

      var cursor = document.createElement('div');
      cursor.setAttribute('aria-hidden', 'true');
      cursor.style.setProperty('position', 'fixed', 'important');
      cursor.style.setProperty('left', '0', 'important');
      cursor.style.setProperty('top', '0', 'important');
      cursor.style.setProperty('width', '14px', 'important');
      cursor.style.setProperty('height', '20px', 'important');
      cursor.style.setProperty('display', 'none', 'important');
      cursor.style.setProperty('z-index', '2147483647', 'important');
      cursor.style.setProperty('pointer-events', 'none', 'important');
      cursor.style.setProperty('margin', '0', 'important');
      cursor.style.setProperty('padding', '0', 'important');
      cursor.style.setProperty('border', '0', 'important');
      cursor.style.setProperty('background', 'transparent', 'important');
      cursor.style.setProperty('filter', 'drop-shadow(0 1px 1px rgba(0,0,0,0.45))', 'important');
      cursor.style.setProperty('overflow', 'visible', 'important');
      cursor.style.setProperty('transform', 'translate3d(-9999px, -9999px, 0)', 'important');
      cursor.style.setProperty('will-change', 'transform', 'important');

      var cursorShadow = cursor.attachShadow({ mode: 'closed' });

      var cursorSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      cursorSvg.setAttribute('viewBox', '0 0 14 20');
      cursorSvg.setAttribute('width', '100%');
      cursorSvg.setAttribute('height', '100%');
      cursorSvg.setAttribute('focusable', 'false');
      cursorSvg.style.cssText = [
        'display: block',
        'overflow: visible',
        'transform: translate3d(0,0,0)',
        'transition: transform 120ms cubic-bezier(.2,.8,.2,1)',
        'will-change: transform'
      ].join(';');

      var cursorPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      cursorPath.setAttribute('d', 'M1 1v16l4.2-4.1 3.3 6.4 2.5-1.3-3.3-6.4H13L1 1Z');
      cursorPath.setAttribute('stroke-linejoin', 'round');
      cursorSvg.appendChild(cursorPath);
      cursorShadow.appendChild(cursorSvg);

      document.head.appendChild(style);
      document.body.appendChild(cursor);

      fakeCursorRef.current = {
        cursor: cursor,
        style: style,
        svg: cursorSvg,
        path: cursorPath,
        clientX: -9999,
        clientY: -9999,
        offsetX: 0,
        hasPointer: false,
        visible: false,
        enabled: false,
        suspended: false
      };

      function updateSize(value) {
        if (!active || !fakeCursorRef.current) return;
        var normalized = normalizeFakeCursorSize(value);
        setFakeCursorSize(normalized);
        fakeCursorSizeRef.current = normalized;
        applyFakeCursorSize(cursor, normalized);
      }

      function updateStyle(value) {
        if (!active || !fakeCursorRef.current) return;
        var normalized = normalizeFakeCursorStyle(value);
        setFakeCursorStyle(normalized);
        fakeCursorStyleRef.current = normalized;
        applyFakeCursorStyle(cursor, normalized);
      }

      function handlePointerMove(event) {
        var state = fakeCursorRef.current;
        if (!state) return;
        state.clientX = event.clientX;
        state.clientY = event.clientY;
        state.hasPointer = true;
        if (state.enabled && !state.suspended) {
          state.visible = true;
          state.cursor.style.setProperty('display', 'block', 'important');
          updateFakeCursorPosition();
        }
      }

      function handleFramePointerMove(event) {
        var data = event.data;
        if (event.source !== window || !data || data.source !== '__exampilotFrameCursor' || data.type !== 'top-move') return;
        var state = fakeCursorRef.current;
        if (!state || !state.enabled) return;
        state.clientX = Number(data.clientX);
        state.clientY = Number(data.clientY);
        if (!Number.isFinite(state.clientX) || !Number.isFinite(state.clientY)) return;
        state.hasPointer = true;
        handleSilentTargetsMouseMove({ clientX: state.clientX, clientY: state.clientY });
        if (state.enabled && !state.suspended) {
          state.visible = true;
          state.cursor.style.setProperty('display', 'block', 'important');
          updateFakeCursorPosition();
        }
      }

      function hideFakeCursor() {
        var state = fakeCursorRef.current;
        if (!state || !state.cursor) return;
        resetSilentHoverState();
        state.visible = false;
        state.hasPointer = false;
        state.cursor.style.setProperty('display', 'none', 'important');
      }

      function handleMouseOut(event) {
        var relatedTarget = event.relatedTarget;
        if (!relatedTarget) hideFakeCursor();
      }

      function handleVisibilityChange() {
        if (document.hidden) hideFakeCursor();
      }

      chrome.storage.local.get(['fakeCursorSize', 'fakeCursorStyle', 'silentModeEnabled']).then(function (data) {
        if (!active) return;
        updateSize(data.fakeCursorSize);
        updateStyle(data.fakeCursorStyle);
        silentModeEnabledRef.current = data.silentModeEnabled === true;
        setSilentModeEnabled(silentModeEnabledRef.current);
        if (silentModeEnabledRef.current && !IS_FULL_ACCESS) {
          window.setTimeout(function () {
            ensureSilentFramePermissions().catch(function () {});
          }, 0);
        }
      }).catch(function () {
        updateSize(DEFAULT_FAKE_CURSOR_SIZE);
        updateStyle(DEFAULT_FAKE_CURSOR_STYLE);
      });

      function storageHandler(changes, areaName) {
        if (areaName !== 'local') return;
        if (changes.fakeCursorSize) updateSize(changes.fakeCursorSize.newValue);
        if (changes.fakeCursorStyle) updateStyle(changes.fakeCursorStyle.newValue);
        if (changes.silentModeEnabled) {
          silentModeEnabledRef.current = changes.silentModeEnabled.newValue === true;
          if (!silentModeEnabledRef.current) removeSilentTarget();
          setSilentModeEnabled(silentModeEnabledRef.current);
        }
      }

      document.addEventListener('mousemove', handlePointerMove, true);
      document.addEventListener('mouseout', handleMouseOut, true);
      window.addEventListener('message', handleFramePointerMove, true);
      window.addEventListener('blur', hideFakeCursor, true);
      document.addEventListener('visibilitychange', handleVisibilityChange, true);
      chrome.storage.onChanged.addListener(storageHandler);

      return function () {
        active = false;
        document.removeEventListener('mousemove', handlePointerMove, true);
        document.removeEventListener('mouseout', handleMouseOut, true);
        window.removeEventListener('message', handleFramePointerMove, true);
        window.removeEventListener('blur', hideFakeCursor, true);
        document.removeEventListener('visibilitychange', handleVisibilityChange, true);
        chrome.storage.onChanged.removeListener(storageHandler);
        document.documentElement.classList.remove('exmp-global-fake-cursor');
        host.classList.remove('exmp-fake-cursor-active');
        if (cursor.parentNode) cursor.parentNode.removeChild(cursor);
        if (style.parentNode) style.parentNode.removeChild(style);
        fakeCursorRef.current = null;
      };
    }, []);

    // The fake cursor only replaces the system cursor while silent mode is active.
    useEffect(function () {
      var state = fakeCursorRef.current;
      if (!state || !state.cursor) return;

      var fakeCursorEnabled = silentModeEnabled && !selectingRegion;
      state.enabled = fakeCursorEnabled;
      state.offsetX = 0;
      if (state.svg) state.svg.style.transform = 'translate3d(0,0,0)';
      if (fakeCursorEnabled) {
        state.style.textContent = 'html.exmp-global-fake-cursor, html.exmp-global-fake-cursor * { cursor: none !important; }';
        document.documentElement.classList.add('exmp-global-fake-cursor');
        host.classList.add('exmp-fake-cursor-active');
        state.cursor.style.setProperty('display', 'none', 'important');
      } else {
        state.style.textContent = '';
        document.documentElement.classList.remove('exmp-global-fake-cursor');
        host.classList.remove('exmp-fake-cursor-active');
        state.hasPointer = false;
        state.visible = false;
        state.cursor.style.setProperty('display', 'none', 'important');
      }
      if (!silentModeEnabled) removeSilentTarget();
    }, [silentModeEnabled, selectingRegion]);

    // ---- Listen for toggle-panel custom event ----
    useEffect(function () {
      function handler() {
        if (host.style.display === 'none') {
          host.style.display = '';
          hiddenByUserRef.current = false;
          hiddenForCaptureRef.current = false;
        } else {
          host.style.display = 'none';
          hiddenByUserRef.current = true;
          hiddenForCaptureRef.current = false;
        }
      }
      function hideHandler() {
        host.style.display = 'none';
        hiddenByUserRef.current = true;
        hiddenForCaptureRef.current = false;
      }
      host.addEventListener('toggle-panel', handler);
      host.addEventListener('hide-panel', hideHandler);
      return function () {
        host.removeEventListener('toggle-panel', handler);
        host.removeEventListener('hide-panel', hideHandler);
      };
    }, []);

    // ---- Listen for extension-level clear command ----
    useEffect(function () {
      function handler() {
        handleCancelOrClear();
      }
      host.addEventListener('clear-results', handler);
      return function () { host.removeEventListener('clear-results', handler); };
    }, [selectingRegion, capturing, showSpinner]);

    useEffect(function () {
      return function () {
        removeSilentTarget();
      };
    }, []);

    // ---- Listen for extension-level shortcut commands ----
    useEffect(function () {
      function handler(event) {
        var mode = event.detail && event.detail.mode;
        if (mode === 'region') {
          handleRegionCapture();
        } else {
          handleFullscreenCapture();
        }
      }
      window.__exampilotPanelReady = true;
      host.addEventListener('start-capture', handler);
      host.dispatchEvent(new CustomEvent('exampilot-panel-ready'));
      return function () {
        window.__exampilotPanelReady = false;
        host.removeEventListener('start-capture', handler);
      };
    }, []);

    // ---- 区域选择模式下按 ESC 取消 ----
    useEffect(function () {
      function handleKeyDown(e) {
        if (e.key === 'Escape' && selectingRegion) {
          cancelRegionSelection();
        }
      }
      if (selectingRegion) {
        document.addEventListener('keydown', handleKeyDown, true);
      }
      return function () {
        document.removeEventListener('keydown', handleKeyDown, true);
      };
    }, [selectingRegion]);

    // ---- 区域选择遮罩层生命周期（挂载到 document.body，不能放 Shadow DOM 内） ----
    useEffect(function () {
      if (!selectingRegion) return;

      var overlay = document.createElement('div');
      overlay.className = 'exmp-selection-overlay';
      applyUiOpacity(overlay, uiOpacity);

      // 遮罩层样式（内嵌 <style>，因为 document.body 在 Shadow DOM 外）
      var style = document.createElement('style');
      style.textContent = `
        .exmp-selection-overlay {
          position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
          background: transparent; z-index: 2147483646; cursor: crosshair;
        }
        .exmp-selection-box {
          position: fixed; border: 1px dashed rgba(79,110,247,0.8); border-radius: 2px;
          background: rgba(79,110,247,0.02); pointer-events: none; display: none;
          z-index: 2147483647;
        }
        .exmp-selection-corner {
          position: absolute; width: 7px; height: 7px;
          background: #fff; border: 1.5px solid rgba(79,110,247,0.8); border-radius: 1.5px;
        }
        .exmp-selection-corner-tl { top: -3px; left: -3px; }
        .exmp-selection-corner-tr { top: -3px; right: -3px; }
        .exmp-selection-corner-bl { bottom: -3px; left: -3px; }
        .exmp-selection-corner-br { bottom: -3px; right: -3px; }
      `;
      overlay.appendChild(style);

      overlay.addEventListener('mousedown', handleSelectionMouseDown);
      overlay.addEventListener('mousemove', handleSelectionMouseMove);
      overlay.addEventListener('mouseup', handleSelectionMouseUp);

      // 选区矩形框 + 四角手柄
      var box = document.createElement('div');
      box.className = 'exmp-selection-box';

      var cornerClasses = ['exmp-selection-corner exmp-selection-corner-tl',
                           'exmp-selection-corner exmp-selection-corner-tr',
                           'exmp-selection-corner exmp-selection-corner-bl',
                           'exmp-selection-corner exmp-selection-corner-br'];
      for (var ci = 0; ci < cornerClasses.length; ci++) {
        var corner = document.createElement('div');
        corner.className = cornerClasses[ci];
        box.appendChild(corner);
      }

      overlay.appendChild(box);
      overlayElRef.current = overlay;
      document.body.appendChild(overlay);

      return function () {
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        if (overlayElRef.current === overlay) {
          overlayElRef.current = null;
        }
      };
    }, [selectingRegion]);

    // ---- Config CRUD helpers ----
    function saveUiOpacity(value) {
      var normalized = applyUiOpacity(host, value);
      setUiOpacity(normalized);
      chrome.storage.local.set({ uiOpacity: normalized }).catch(function () {
        // Keep the locally applied value if persistence is temporarily unavailable.
      });
    }

    function saveFakeCursorSize(value) {
      var normalized = normalizeFakeCursorSize(value);
      setFakeCursorSize(normalized);
      fakeCursorSizeRef.current = normalized;
      if (fakeCursorRef.current && fakeCursorRef.current.cursor) {
        applyFakeCursorSize(fakeCursorRef.current.cursor, normalized);
      }
      chrome.storage.local.set({ fakeCursorSize: normalized }).catch(function () {
        // Keep the locally applied value if persistence is temporarily unavailable.
      });
    }

    function saveFakeCursorStyle(value) {
      var normalized = normalizeFakeCursorStyle(value);
      setFakeCursorStyle(normalized);
      fakeCursorStyleRef.current = normalized;
      if (fakeCursorRef.current && fakeCursorRef.current.cursor) {
        applyFakeCursorStyle(fakeCursorRef.current.cursor, normalized);
      }
      chrome.storage.local.set({ fakeCursorStyle: normalized }).catch(function () {
        // Keep the locally applied value if persistence is temporarily unavailable.
      });
    }

    function loadSilentMode() {
      chrome.runtime.sendMessage({ action: 'getSilentMode' }).then(function (res) {
        if (res && res.success) {
          silentModeEnabledRef.current = res.silentModeEnabled === true;
          setSilentModeEnabled(res.silentModeEnabled === true);
          setSilentDebugFrameEnabled(res.silentDebugFrameEnabled === true);
        }
      }).catch(function () {});
    }

    function getCrossOriginIframeUrls() {
      var seen = {};
      return Array.prototype.map.call(document.querySelectorAll('iframe[src], frame[src]'), function (frame) {
        try {
          var url = new URL(frame.getAttribute('src'), document.baseURI);
          if (url.protocol !== 'https:' || url.origin === window.location.origin || seen[url.origin]) return null;
          seen[url.origin] = true;
          return url.href;
        } catch (error) {
          return null;
        }
      }).filter(Boolean);
    }

    function ensureSilentFramePermissions() {
      if (IS_FULL_ACCESS) return Promise.resolve(true);
      var urls = getCrossOriginIframeUrls();
      return urls.reduce(function (chain, url) {
        return chain.then(function (grantedSoFar) {
          if (!grantedSoFar) return false;
          return checkApiHostPermission(url).then(function (permission) {
            if (!permission || !permission.success) return false;
            if (permission.granted) return true;
            return showApiHostPermissionFrame(permission.origin, 'frame');
          });
        });
      }, Promise.resolve(true)).then(function (granted) {
        if (!granted) return false;
        return chrome.runtime.sendMessage({ action: 'injectFrameCursorBridge' }).then(function (response) {
          return !!(response && response.success);
        });
      });
    }

    useEffect(function () {
      if (IS_FULL_ACCESS || !silentModeEnabled) return;
      var timer = null;

      function scheduleFramePermissionCheck() {
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(function () {
          timer = null;
          ensureSilentFramePermissions().catch(function () {});
        }, 150);
      }

      function containsFrame(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        if (node.tagName === 'IFRAME' || node.tagName === 'FRAME') return true;
        return !!(node.querySelector && node.querySelector('iframe, frame'));
      }

      var observer = new MutationObserver(function (mutations) {
        var needsCheck = mutations.some(function (mutation) {
          if (mutation.type === 'attributes') return containsFrame(mutation.target);
          return Array.prototype.some.call(mutation.addedNodes, containsFrame);
        });
        if (needsCheck) scheduleFramePermissionCheck();
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src']
      });

      function handleFrameLoad(event) {
        if (containsFrame(event.target)) scheduleFramePermissionCheck();
      }

      document.addEventListener('load', handleFrameLoad, true);
      return function () {
        if (timer !== null) window.clearTimeout(timer);
        observer.disconnect();
        document.removeEventListener('load', handleFrameLoad, true);
      };
    }, [silentModeEnabled]);

    function persistSilentMode(enabled) {
      silentModeEnabledRef.current = enabled;
      setSilentModeEnabled(enabled);
      if (!enabled) removeSilentTarget();
      chrome.runtime.sendMessage({
        action: 'setSilentMode',
        silentModeEnabled: enabled
      }).then(function (res) {
        if (!res || !res.success) loadSilentMode();
      }).catch(function () {
        loadSilentMode();
      });
    }

    function saveSilentMode(value) {
      var enabled = value === true;
      if (!enabled) {
        persistSilentMode(false);
        return;
      }
      ensureSilentFramePermissions().then(function (granted) {
        if (granted) persistSilentMode(true);
      }).catch(function () {
        loadSilentMode();
      });
    }

    function applySilentDebugFrameVisibility(enabled) {
      var state = silentTargetRef.current;
      var states = Array.isArray(state) ? state : (state ? [state] : []);
      states.forEach(function (item) {
        if (item && item.updateVisualState) item.updateVisualState(enabled);
      });
    }

    function saveSilentDebugFrame(value) {
      var enabled = value === true;
      setSilentDebugFrameEnabled(enabled);
      applySilentDebugFrameVisibility(enabled);
      chrome.runtime.sendMessage({
        action: 'setSilentDebugFrame',
        silentDebugFrameEnabled: enabled
      }).catch(function () {
        loadSilentMode();
      });
    }

    function loadConfigs() {
      chrome.runtime.sendMessage({ action: 'getConfigs' }).then(function (res) {
        if (res.success) setConfigList(res.configList || []);
      });
    }

    function loadPrompt() {
      chrome.runtime.sendMessage({ action: 'getPrompt' }).then(function (res) {
        if (res.success) {
          setCustomPrompt(res.prompt || '');
          setSilentPrompt(res.silentPrompt || '');
        }
      });
    }

    function savePrompt() {
      setPromptSaving(true);
      chrome.runtime.sendMessage({ action: 'setPrompt', prompt: customPrompt }).then(function () {
        setPromptSaving(false);
      }).catch(function () {
        setPromptSaving(false);
      });
    }

    function saveSilentPrompt() {
      setSilentPromptSaving(true);
      chrome.runtime.sendMessage({ action: 'setSilentPrompt', prompt: silentPrompt }).then(function () {
        setSilentPromptSaving(false);
      }).catch(function () {
        setSilentPromptSaving(false);
      });
    }

    function selectConfig(id) {
      chrome.runtime.sendMessage({ action: 'setActiveConfig', configId: id }).then(loadConfigs);
    }

    function deleteConfig(id) {
      chrome.runtime.sendMessage({ action: 'deleteConfig', configId: id }).then(loadConfigs);
    }

    function exportSettings() {
      setTransferBusy(true);
      setTransferMessage(null);
      chrome.runtime.sendMessage({ action: 'exportSettings' }).then(function (res) {
        if (!res || !res.success) {
          throw new Error(res && res.error ? res.error : '导出失败');
        }
        var blob = new Blob([JSON.stringify(res.backup, null, 2)], { type: 'application/json' });
        var downloadUrl = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = downloadUrl;
        link.download = 'exampilot-settings-' + new Date().toISOString().slice(0, 10) + '.json';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(downloadUrl); }, 1000);
        setTransferMessage({ type: 'success', text: '配置已导出，请妥善保管文件' });
      }).catch(function (error) {
        setTransferMessage({ type: 'error', text: error.message || String(error) });
      }).then(function () {
        setTransferBusy(false);
      });
    }

    function chooseImportFile() {
      if (importInputRef.current) importInputRef.current.click();
    }

    function importSettings(event) {
      var input = event.target;
      var file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        setTransferMessage({ type: 'error', text: '配置文件不能超过 2 MB' });
        return;
      }
      if (!window.confirm('导入会替换当前电脑上的全部 ExamPilot 配置，是否继续？')) return;

      setTransferBusy(true);
      setTransferMessage(null);
      file.text().then(function (text) {
        var backup;
        try {
          backup = JSON.parse(text);
        } catch (_) {
          throw new Error('配置文件不是有效的 JSON');
        }
        return chrome.runtime.sendMessage({ action: 'importSettings', backup: backup });
      }).then(function (res) {
        if (!res || !res.success) {
          throw new Error(res && res.error ? res.error : '导入失败');
        }
        cancelForm();
        loadConfigs();
        loadPrompt();
        loadSilentMode();
        return chrome.storage.local.get('uiOpacity').then(function (data) {
          var normalized = applyUiOpacity(host, data.uiOpacity);
          setUiOpacity(normalized);
          setTransferMessage({
            type: 'success',
            text: '已导入 ' + res.configCount + ' 个配置，首次使用新域名时需授权'
          });
        });
      }).catch(function (error) {
        setTransferMessage({ type: 'error', text: error.message || String(error) });
      }).then(function () {
        setTransferBusy(false);
      });
    }

    function openAddForm() {
      setEditingId(null);
      setFormName('');
      setFormUrl('');
      setFormModel('');
      setFormKey('');
      setFormMode('chat-completions');
      setFormHeadersJson('');
      setFormBodyJson('');
      setFormTemplateHeadersJson('');
      setFormTemplateBodyJson('');
      setFormTemplateResponseText('');
      setShowHeadersSection(false);
      setShowBodySection(false);
      setShowResponseSection(false);
      setShowPreview(false);
      setFormError('');
      setShowForm(true);
    }

    function openEditForm(id) {
      chrome.runtime.sendMessage({ action: 'getConfig', configId: id }).then(function (res) {
        if (res.success) {
          setEditingId(id);
          setFormName(res.config.name || '');
          setFormUrl(res.config.url || '');
          setFormModel(res.config.model || '');
          setFormKey(res.config.apiKey || '');
          setFormMode(res.config.apiMode || 'chat-completions');
          setFormHeadersJson(res.config.customHeadersJson || '');
          setFormBodyJson(res.config.customBodyJson || '');
          setFormTemplateHeadersJson(res.config.templateHeadersJson || (res.config.apiMode === 'custom-template' ? getDefaultTemplateHeadersJson() : ''));
          setFormTemplateBodyJson(res.config.templateBodyJson || (res.config.apiMode === 'custom-template' ? getDefaultTemplateBodyJson() : ''));
          setFormTemplateResponseText(res.config.templateResponseText || (res.config.apiMode === 'custom-template' ? getDefaultTemplateResponseText() : ''));
          setShowHeadersSection(res.config.apiMode === 'custom-template');
          setShowBodySection(res.config.apiMode === 'custom-template');
          setShowResponseSection(res.config.apiMode === 'custom-template');
          setShowPreview(false);
          setFormError('');
          setShowForm(true);
        }
      });
    }

    function cancelForm() {
      setShowForm(false);
      setEditingId(null);
      setFormError('');
    }

    function checkApiHostPermission(url) {
      return chrome.runtime.sendMessage({ action: 'checkApiHostPermission', url: url });
    }

    function showApiHostPermissionFrame(origin, purpose) {
      var requestPurpose = purpose || 'api';
      if (__permissionRequest && __permissionRequest.origin === origin &&
          __permissionRequest.purpose === requestPurpose) {
        return __permissionRequest.promise;
      }

      var previousRequest = __permissionRequest ? __permissionRequest.promise : Promise.resolve();
      var queuedRequest = previousRequest.catch(function () {
        return false;
      }).then(function () {
        return createApiHostPermissionFrame(origin, requestPurpose);
      });
      var requestRecord = {
        origin: origin,
        purpose: requestPurpose,
        promise: queuedRequest
      };
      __permissionRequest = requestRecord;
      queuedRequest.then(clearQueuedRequest, clearQueuedRequest);

      function clearQueuedRequest() {
        if (__permissionRequest === requestRecord) __permissionRequest = null;
      }

      return queuedRequest;
    }

    function createApiHostPermissionFrame(origin, purpose) {
      return new Promise(function (resolve) {
        if (__permissionHandler) {
          window.removeEventListener('message', __permissionHandler);
          __permissionHandler = null;
        }

        var old = document.getElementById('exmp-permission-overlay');
        if (old && old.parentNode) {
          old.parentNode.removeChild(old);
        }

        var overlay = document.createElement('div');
        overlay.id = 'exmp-permission-overlay';
        overlay.style.cssText = [
          'position: fixed',
          'inset: 0',
          'z-index: 2147483647',
          'display: flex',
          'align-items: center',
          'justify-content: center',
          'background: rgba(16, 24, 40, 0.42)'
        ].join(';');

        var frameWrap = document.createElement('div');
        frameWrap.style.cssText = [
          'width: min(420px, calc(100vw - 28px))',
          'height: 330px',
          'border-radius: 10px',
          'box-shadow: 0 18px 44px rgba(16, 24, 40, 0.28)',
          'overflow: hidden',
          'background: #fff',
          'position: relative'
        ].join(';');

        var closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.setAttribute('aria-label', '关闭授权');
        closeBtn.style.cssText = [
          'position: absolute',
          'top: 8px',
          'right: 10px',
          'z-index: 2',
          'width: 28px',
          'height: 28px',
          'border: none',
          'border-radius: 14px',
          'background: rgba(242, 244, 247, 0.9)',
          'color: #667085',
          'font-size: 18px',
          'line-height: 28px',
          'cursor: pointer'
        ].join(';');

        var iframe = document.createElement('iframe');
        iframe.src = chrome.runtime.getURL(
          'permission/host-permission.html?embed=1&origin=' + encodeURIComponent(origin) +
          '&purpose=' + encodeURIComponent(purpose || 'api')
        );
        iframe.style.cssText = 'width: 100%; height: 100%; border: 0; display: block;';
        iframe.setAttribute('title', 'ExamPilot API 域名授权');

        function cleanup(result) {
          window.removeEventListener('message', handleMessage);
          __permissionHandler = null;
          if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
          }
          host.style.display = 'none';
          hiddenByUserRef.current = true;
          hiddenForCaptureRef.current = false;
          resolve(result);
        }

        function handleMessage(event) {
          if (event.source !== iframe.contentWindow) return;
          var data = event.data || {};
          if (data.source !== 'exampilot-permission') return;
          cleanup(!!data.granted);
        }

        closeBtn.addEventListener('click', function () {
          cleanup(false);
        });
        overlay.addEventListener('click', function (event) {
          if (event.target === overlay) {
            cleanup(false);
          }
        });
        __permissionHandler = handleMessage;
        window.addEventListener('message', handleMessage);

        frameWrap.appendChild(closeBtn);
        frameWrap.appendChild(iframe);
        overlay.appendChild(frameWrap);
        document.body.appendChild(overlay);
      });
    }

    function ensureActiveConfigBeforeCapture() {
      return chrome.runtime.sendMessage({ action: 'getConfigs' }).then(function (res) {
        if (!res.success) {
          throw new Error(res.error || '读取配置失败');
        }
        var list = res.configList || [];
        var selected = list.find(function (cfg) { return cfg.selected; });
        if (!selected) {
          throw new Error('请先点击 ⚙️ 选择 AI 配置');
        }
        if (IS_FULL_ACCESS) {
          return true;
        }
        return checkApiHostPermission(selected.url).then(function (perm) {
          if (!perm.success) {
            throw new Error(perm.error || '授权检查失败');
          }
          if (perm.granted) {
            return true;
          }
          var message = '需要先授权访问 ' + perm.origin + '。请在当前页面完成授权后再次点击识别。';
          setStatusText('需要授权接口域名');
          setShowSpinner(false);
          setAnswers(function (prev) { return prev.concat([{ type: 'error', content: '❌ ' + message }]); });
          return showApiHostPermissionFrame(perm.origin).then(function (granted) {
            if (granted) {
              setStatusText('授权成功');
            }
            return false;
          });
        });
      });
    }

    function saveConfigPayload(payload) {
      return chrome.runtime.sendMessage(payload).then(function (res) {
        if (res.success) {
          cancelForm();
          loadConfigs();
        } else {
          setFormError(res.error || '保存失败');
        }
      });
    }

    function isPlainObject(value) {
      return Object.prototype.toString.call(value) === '[object Object]';
    }

    function cloneJson(value) {
      if (value === undefined) return undefined;
      return JSON.parse(JSON.stringify(value));
    }

    function mergeJsonOverride(base, override) {
      var result = isPlainObject(base) ? cloneJson(base) : {};
      var patch = isPlainObject(override) ? override : {};
      Object.keys(patch).forEach(function (key) {
        var value = patch[key];
        if (value === null) {
          delete result[key];
          return;
        }
        if (isPlainObject(value) && isPlainObject(result[key])) {
          result[key] = mergeJsonOverride(result[key], value);
          return;
        }
        result[key] = cloneJson(value);
      });
      return result;
    }

    function parseJsonObjectOverride(rawValue, label) {
      var text = (rawValue || '').trim();
      if (!text) return {};
      var parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error(label + ' 不是有效的 JSON: ' + (err.message || String(err)));
      }
      if (!isPlainObject(parsed)) {
        throw new Error(label + ' 必须是 JSON 对象');
      }
      return parsed;
    }

    function buildTemplatePreviewContext() {
      return {
        model: formModel || '(未设置)',
        apiKey: formKey ? '<api_key>' : '',
        apiKeyBearer: formKey ? 'Bearer <api_key>' : '',
        prompt: '<prompt>',
        imageUrl: '<base64_image_url>',
        imageBase64: '<base64_image>',
        base64Image: '<base64_image>',
        imageMimeType: 'image/jpeg',
        mimeType: 'image/jpeg'
      };
    }

    function maskPreviewHeaders(headers) {
      var masked = {};
      Object.keys(headers).forEach(function (key) {
        var value = headers[key];
        if (/authorization|api-key|apikey|token|key/i.test(key)) {
          if (!value || value === '(未设置)') {
            masked[key] = value || '(空)';
            return;
          }
          masked[key] = String(value).slice(0, 12) + '...';
          return;
        }
        masked[key] = value;
      });
      return masked;
    }

    function buildPreviewHeaders() {
      if (formMode === 'custom-template') {
        return maskPreviewHeaders(renderJsonObjectTemplate(
          formTemplateHeadersJson || getDefaultTemplateHeadersJson(),
          buildTemplatePreviewContext(),
          'Headers 模板'
        ));
      }
      var previewHeaders = {
        'Content-Type': 'application/json'
      };
      if (formMode === 'anthropic') {
        previewHeaders['x-api-key'] = formKey ? formKey : '(未设置)';
      } else {
        previewHeaders['Authorization'] = formKey ? 'Bearer ' + formKey : '(未设置)';
      }
      return maskPreviewHeaders(mergeJsonOverride(previewHeaders, parseJsonObjectOverride(formHeadersJson, 'Headers JSON')));
    }

    function buildPreviewBody() {
      if (formMode === 'custom-template') {
        return renderJsonTemplate(
          formTemplateBodyJson || getDefaultTemplateBodyJson(),
          buildTemplatePreviewContext(),
          'Body 模板'
        );
      }
      var previewBody = { model: formModel || '(未设置)' };
      if (formMode === 'responses-api') {
        previewBody.input = [{ role: 'user', content: [{ type: 'input_image', image_url: '<base64_image>' }, { type: 'input_text', text: '<prompt>' }] }];
      } else if (formMode === 'anthropic') {
        previewBody.messages = [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '<base64_image>' } }, { type: 'text', text: '<prompt>' }] }];
      } else {
        previewBody.messages = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: '<base64_image>' } }, { type: 'text', text: '<prompt>' }] }];
      }
      return mergeJsonOverride(previewBody, parseJsonObjectOverride(formBodyJson, 'Body JSON'));
    }

    function saveForm() {
      setFormError('');
      if (!formName || !formUrl) {
        setFormError('请填写配置名称和接口地址');
        return;
      }
      if (formMode !== 'custom-template' && (!formModel || !formKey)) {
        setFormError('请填写模型名称和 API Key');
        return;
      }
      setConfigSaving(true);

      try {
        if (formMode === 'custom-template') {
          var previewContext = buildTemplatePreviewContext();
          renderJsonObjectTemplate(formTemplateHeadersJson || getDefaultTemplateHeadersJson(), previewContext, 'Headers 模板');
          renderJsonTemplate(formTemplateBodyJson || getDefaultTemplateBodyJson(), previewContext, 'Body 模板');
          if (!(formTemplateResponseText || getDefaultTemplateResponseText()).trim()) {
            throw new Error('响应模板不能为空');
          }
        } else {
          parseJsonObjectOverride(formHeadersJson, 'Headers JSON');
          parseJsonObjectOverride(formBodyJson, 'Body JSON');
        }
      } catch (error) {
        setFormError(error.message || String(error));
        setConfigSaving(false);
        return;
      }

      var action = editingId ? 'editConfig' : 'addConfig';
      var configPayload = {
        name: formName,
        url: formUrl,
        model: formModel,
        apiKey: formKey,
        apiMode: formMode,
        customHeadersJson: formHeadersJson,
        customBodyJson: formBodyJson,
        templateHeadersJson: formTemplateHeadersJson,
        templateBodyJson: formTemplateBodyJson,
        templateResponseText: formTemplateResponseText
      };
      var payload = editingId
        ? { action: action, configId: editingId, config: configPayload }
        : { action: action, config: configPayload };

      var savePromise;
      if (IS_FULL_ACCESS) {
        savePromise = saveConfigPayload(payload);
      } else {
        savePromise = checkApiHostPermission(formUrl).then(function (res) {
          if (!res.success) {
            throw new Error(res.error || '授权检查失败');
          }
          if (!res.granted) {
            setFormError('需要先授权访问 ' + res.origin + '。请在当前页面完成授权。');
            return showApiHostPermissionFrame(res.origin).then(function (granted) {
              if (granted) {
                return saveConfigPayload(payload);
              }
            });
          }
          return saveConfigPayload(payload);
        });
      }

      savePromise.catch(function (error) {
        setFormError(error.message || String(error));
      }).then(function () {
        setConfigSaving(false);
      });
    }

    function buildViewportPayload() {
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio || 1
      };
    }

    async function copySilentClipboardText(text) {
      var value = String(text || '').trim();
      if (!value) return false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(value);
          return true;
        }
      } catch (error) {
        // Some pages block Clipboard API from content scripts; fall back below.
      }
      try {
        var textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.cssText = [
          'position: fixed',
          'left: -9999px',
          'top: 0',
          'width: 1px',
          'height: 1px',
          'opacity: 0',
          'pointer-events: none'
        ].join(';');
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        var copied = document.execCommand('copy');
        return copied === true;
      } catch (error) {
        return false;
      } finally {
        if (textarea && textarea.parentNode) textarea.parentNode.removeChild(textarea);
      }
    }

    function clearSilentHoverTimer() {
      if (silentHoverTimerRef.current) {
        window.clearTimeout(silentHoverTimerRef.current);
        silentHoverTimerRef.current = null;
      }
      silentHoverTargetRef.current = null;
    }

    function resetSilentHoverState() {
      clearSilentHoverTimer();
      var state = silentTargetRef.current;
      var states = Array.isArray(state) ? state : (state ? [state] : []);
      states.forEach(function (item) {
        if (!item) return;
        item.isHovering = false;
        item.hoverTriggered = false;
      });
      silentActiveTargetRef.current = null;
      resetSilentCursorFeedback();
    }

    function scheduleSilentHover(state) {
      if (!state || state.hoverTriggered || silentHoverTimerRef.current) return;
      silentHoverTargetRef.current = state;
      silentHoverTimerRef.current = window.setTimeout(function () {
        silentHoverTimerRef.current = null;
        silentHoverTargetRef.current = null;
        if (silentActiveTargetRef.current !== state || !state.isHovering || state.hoverTriggered) return;
        state.hoverTriggered = true;
        triggerSilentCursorFeedback();
        setStatusText('静默模式已触发');
      }, 350);
    }

    function handleSilentTargetsMouseMove(event) {
      var states = Array.isArray(silentTargetRef.current) ? silentTargetRef.current : [];
      var nextState = states.find(function (item) {
        return item && item.containsPoint(event.clientX, event.clientY);
      }) || null;
      var activeState = silentActiveTargetRef.current;

      if (activeState !== nextState) {
        clearSilentHoverTimer();
        if (activeState) {
          activeState.isHovering = false;
          activeState.hoverTriggered = false;
        }
        resetSilentCursorFeedback();
        silentActiveTargetRef.current = nextState;
        if (nextState) {
          nextState.isHovering = true;
          nextState.hoverTriggered = false;
        }
      }

      if (!nextState) return;
      nextState.lastClientX = event.clientX;
      nextState.lastClientY = event.clientY;
      scheduleSilentHover(nextState);
    }

    function applyFakeCursorSize(cursor, value) {
      var size = normalizeFakeCursorSize(value);
      var height = Math.round(size * 20 / 14);
      cursor.style.setProperty('width', size + 'px', 'important');
      cursor.style.setProperty('height', height + 'px', 'important');
      applyFakeCursorStyle(cursor, fakeCursorStyleRef.current);
    }

    function applyFakeCursorStyle(cursor, value) {
      var style = normalizeFakeCursorStyle(value);
      var fill = style === 'light-outline' ? '#fff' : '#000';
      var stroke = style === 'light-outline' ? '#000' : '#fff';
      var strokeWidth = style === 'light-outline' ? '0.65' : '1.5';
      var state = fakeCursorRef.current;
      var path = state && state.cursor === cursor ? state.path : cursor.querySelector('path');
      if (!path) return;
      path.setAttribute('fill', fill);
      path.setAttribute('stroke', stroke);
      path.setAttribute('stroke-width', strokeWidth);
      cursor.style.setProperty(
        'filter',
        style === 'light-outline' ? 'none' : 'drop-shadow(0 1px 1px rgba(0,0,0,0.45))',
        'important'
      );
    }

    function updateFakeCursorPosition() {
      var state = fakeCursorRef.current;
      if (!state || !state.cursor || !state.hasPointer) return;
      state.cursor.style.setProperty(
        'transform',
        'translate3d(' + Math.round(state.clientX) + 'px, ' + Math.round(state.clientY) + 'px, 0)',
        'important'
      );
    }

    function triggerSilentCursorFeedback() {
      var state = fakeCursorRef.current;
      if (!state) return;
      state.offsetX = 5;
      if (state.svg) state.svg.style.transform = 'translate3d(5px,0,0)';
    }

    function resetSilentCursorFeedback() {
      var state = fakeCursorRef.current;
      if (!state || state.offsetX === 0) return;
      state.offsetX = 0;
      if (state.svg) state.svg.style.transform = 'translate3d(0,0,0)';
    }

    function removeSilentTarget() {
      resetSilentHoverState();
      var state = silentTargetRef.current;
      var states = Array.isArray(state) ? state : (state ? [state] : []);
      states.forEach(function (item) {
        if (!item) return;
        window.removeEventListener('scroll', item.updatePosition, true);
        window.removeEventListener('resize', item.updatePosition, true);
        if (item.el && item.el.parentNode) {
          item.el.parentNode.removeChild(item.el);
        }
      });
      if (silentMouseMoveHandlerRef.current) {
        document.removeEventListener('mousemove', silentMouseMoveHandlerRef.current, true);
        silentMouseMoveHandlerRef.current = null;
      }
      silentTargetRef.current = null;
    }

    function installSingleSilentTarget(result, index) {
      var target = result && result.target;
      if (!target) return null;
      var x = Number(target.x);
      var y = Number(target.y);
      var width = Number(target.width);
      var height = Number(target.height);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return null;

      var color = '#ef4444';
      var el = document.createElement('div');
      el.className = 'exmp-silent-target';
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = [
        'position: fixed',
        'left: 0',
        'top: 0',
        'width: 32px',
        'height: 32px',
        'z-index: 2147483645',
        'pointer-events: none',
        'cursor: default',
        'box-sizing: border-box'
      ].join(';');

      var center = document.createElement('div');
      center.style.cssText = [
        'position: absolute',
        'left: 50%',
        'top: 50%',
        'width: 10px',
        'height: 10px',
        'margin-left: -5px',
        'margin-top: -5px',
        'border-radius: 50%',
        'background: ' + color,
        'box-shadow: 0 0 0 2px #fff'
      ].join(';');
      el.appendChild(center);

      var docX = window.scrollX + x;
      var docY = window.scrollY + y;
      var state = {
        el: el,
        docX: docX,
        docY: docY,
        width: Math.max(8, width),
        height: Math.max(8, height),
        isHovering: false,
        hoverTriggered: false,
        lastClientX: null,
        lastClientY: null,
        center: center,
        updateVisualState: function (enabled) {
          el.style.border = enabled ? '2px solid ' + color : '2px solid transparent';
          el.style.background = enabled ? 'rgba(239,68,68,0.12)' : 'transparent';
          center.style.display = enabled ? 'block' : 'none';
        },
        updatePosition: function () {
          el.style.left = (state.docX - window.scrollX) + 'px';
          el.style.top = (state.docY - window.scrollY) + 'px';
          el.style.width = state.width + 'px';
          el.style.height = state.height + 'px';
        },
        containsPoint: function (clientX, clientY) {
          var left = state.docX - window.scrollX;
          var top = state.docY - window.scrollY;
          return clientX >= left &&
            clientX <= left + state.width &&
            clientY >= top &&
            clientY <= top + state.height;
        }
      };

      document.body.appendChild(el);
      state.updateVisualState(silentDebugFrameEnabledRef.current);
      state.updatePosition();
      window.addEventListener('scroll', state.updatePosition, true);
      window.addEventListener('resize', state.updatePosition, true);
      return state;
    }

    function installSilentTarget(result) {
      removeSilentTarget();
      var targets = result && Array.isArray(result.targets) ? result.targets : [result];
      var states = [];
      targets.forEach(function (item, index) {
        var state = installSingleSilentTarget(item, index);
        if (state) states.push(state);
      });
      silentTargetRef.current = states;
      if (states.length > 0) {
        silentMouseMoveHandlerRef.current = handleSilentTargetsMouseMove;
        document.addEventListener('mousemove', silentMouseMoveHandlerRef.current, true);
      }
    }

    function handleFullscreenCapture() {
      currentRequestSeqRef.current++;
      var mySeq = currentRequestSeqRef.current;
      removeSilentTarget();
      setCapturing(true);
      setStatusText('准备中...');
      setShowSpinner(true);

      ensureActiveConfigBeforeCapture().then(function (ok) {
        if (!ok) return null;
        return chrome.runtime.sendMessage({
          action: 'captureAndAnalyze',
          viewport: buildViewportPayload()
        });
      }).then(function (response) {
        if (!response) return;
        handleCaptureResponse(response, mySeq);
      }).catch(function (error) {
        handleCaptureError(error, mySeq);
      }).then(function () {
        handleCaptureFinally(mySeq);
      });
    }

    function handleRegionCapture() {
      currentRequestSeqRef.current++;
      var mySeq = currentRequestSeqRef.current;
      removeSilentTarget();
      setCapturing(true);
      setStatusText('准备中...');
      setShowSpinner(true);

      ensureActiveConfigBeforeCapture().then(function (ok) {
        if (mySeq !== currentRequestSeqRef.current) return;
        if (!ok) return;
        setCapturing(false);
        setShowSpinner(false);
        setSelectingRegion(true);
        setStatusText('请拖拽选择识别区域...');
        host.style.display = 'none';
        hiddenByUserRef.current = true;
      }).catch(function (error) {
        handleCaptureError(error, mySeq);
      }).then(function () {
        handleCaptureFinally(mySeq);
      });
    }

    function cancelCapture() {
      currentRequestSeqRef.current++;
      resumeFakeCursorAfterCapture();
      removeSilentTarget();
      setCapturing(false);
      setShowSpinner(false);
      setStatusText('已取消');
      chrome.runtime.sendMessage({ action: 'cancelCapture' }).catch(function () {});
    }

    function handleCancelOrClear() {
      if (selectingRegion) {
        cancelRegionSelection();
      } else if (capturing || showSpinner) {
        cancelCapture();
      } else {
        handleClear();
      }
    }

    function cancelRegionSelection() {
      setSelectingRegion(false);
      removeRegionOverlay();
      setStatusText('');
      host.style.display = '';
      hiddenByUserRef.current = false;
      setViewState('main');
    }

    function removeRegionOverlay() {
      var overlay = overlayElRef.current;
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      overlayElRef.current = null;
    }

    function handleSelectionMouseDown(e) {
      e.preventDefault();
      e.stopPropagation();
      if (overlayElRef.current) {
        var box = overlayElRef.current.querySelector('.exmp-selection-box');
        if (box) {
          box.style.display = 'block';
          box.style.left = e.clientX + 'px';
          box.style.top = e.clientY + 'px';
          box.style.width = '0px';
          box.style.height = '0px';
          // 将起点坐标存储在矩形框的自定义属性上
          box._startX = e.clientX;
          box._startY = e.clientY;
        }
      }
    }

    function handleSelectionMouseMove(e) {
      if (!overlayElRef.current) return;
      var box = overlayElRef.current.querySelector('.exmp-selection-box');
      if (!box || box.style.display === 'none') return;
      var x1 = Math.min(box._startX, e.clientX);
      var y1 = Math.min(box._startY, e.clientY);
      var w = Math.abs(e.clientX - box._startX);
      var h = Math.abs(e.clientY - box._startY);
      box.style.left = x1 + 'px';
      box.style.top = y1 + 'px';
      box.style.width = w + 'px';
      box.style.height = h + 'px';
    }

    function handleSelectionMouseUp(e) {
      if (!overlayElRef.current) {
        cancelRegionSelection();
        return;
      }
      var box = overlayElRef.current.querySelector('.exmp-selection-box');
      if (!box || box.style.display === 'none') {
        cancelRegionSelection();
        return;
      }
      var rect = {
        x: parseFloat(box.style.left) || 0,
        y: parseFloat(box.style.top) || 0,
        width: parseFloat(box.style.width) || 0,
        height: parseFloat(box.style.height) || 0,
        dpr: window.devicePixelRatio || 1
      };

      setSelectingRegion(false);
      removeRegionOverlay();

      var MIN_SIZE = 20;
      if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
        setStatusText('');
        host.style.display = '';
        hiddenByUserRef.current = false;
        setViewState('main');
        return;
      }

      host.style.display = '';
      hiddenByUserRef.current = false;

      currentRequestSeqRef.current++;
      var mySeq = currentRequestSeqRef.current;
      setCapturing(true);
      setStatusText('准备中...');
      setShowSpinner(true);

      ensureActiveConfigBeforeCapture().then(function (ok) {
        if (!ok) return null;
        setStatusText('截图中...');
        return chrome.runtime.sendMessage({
          action: 'captureAndAnalyzeWithRect',
          rect: rect,
          viewport: buildViewportPayload()
        });
      }).then(function (response) {
        if (!response) return;
        handleCaptureResponse(response, mySeq);
      }).catch(function (error) {
        handleCaptureError(error, mySeq);
      }).then(function () {
        handleCaptureFinally(mySeq);
      });
    }

    function handleClear() {
      removeSilentTarget();
      setAnswers([]);
      setStatusText('');
    }

    function openConfigView() {
      loadConfigs();
      loadPrompt();
      loadSilentMode();
      setViewState('config');
    }

    // ---- Render ----
    return html`
      <style>
        /* Utility classes — use these instead of writing repetitive CSS */
        .exmp-flex { display: flex; }
        .exmp-flex-col { flex-direction: column; }
        .exmp-items-center { align-items: center; }
        .exmp-justify-between { justify-content: space-between; }
        .exmp-gap-6 { gap: 6px; }
        .exmp-w-full { width: 100%; }
        .exmp-p-8-14 { padding: 8px 14px; }
        .exmp-p-6-14 { padding: 6px 14px; }
        .exmp-text-11 { font-size: 11px; }
        .exmp-text-12 { font-size: 12px; }
        .exmp-text-13 { font-size: 13px; }
        .exmp-rounded-8 { border-radius: 8px; }

        :host {
          all: initial;
          display: flex;
          flex-direction: column;
          align-items: var(--exmp-align-items, flex-end);
          position: fixed !important;
          top: var(--exmp-top, auto) !important;
          bottom: var(--exmp-bottom, 24px) !important;
          left: var(--exmp-left, auto) !important;
          right: var(--exmp-right, 24px) !important;
          z-index: 2147483647 !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif !important;
          font-size: 13px !important;
          line-height: 1.6 !important;
          color: #213547 !important;
          pointer-events: none !important;
        }
        :host(.exmp-fake-cursor-active),
        :host(.exmp-fake-cursor-active) * {
          cursor: none !important;
        }
        * {
          pointer-events: auto !important;
          box-sizing: border-box !important;
        }
        .exmp-panel {
          width: 370px;
          max-height: min(520px, 60vh);
          background: #ffffff;
          border-radius: 14px;
          box-shadow: 0 4px 24px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06);
          border: 1px solid #eef0f2;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .exmp-mini {
          width: 44px;
          height: 44px;
          border-radius: 22px;
          background: #4f6ef7;
          color: #fff;
          font-size: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: grab;
          touch-action: none;
          user-select: none;
          box-shadow: 0 2px 12px rgba(79,110,247,0.35);
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .exmp-mini:hover {
          transform: scale(1.1);
          box-shadow: 0 4px 16px rgba(79,110,247,0.45);
        }
        .exmp-mini:active { cursor: grabbing; }
        .exmp-footer {
          border-top: 1px solid #f0f1f3;
          flex: 0 0 auto;
          min-height: 36px;
        }
        .exmp-title {
          font-size: 12px;
          font-weight: 600;
          color: #667085;
          letter-spacing: 0.3px;
        }
        /* .exmp-buttons — use exmp-flex exmp-items-center exmp-gap-6 instead */
        .exmp-btn {
          padding: 5px 13px;
          border: none;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s;
        }
        .exmp-btn-start {
          background: #4f6ef7;
          color: #fff;
        }
        .exmp-btn-start:hover { background: #3b5de7; }
        .exmp-btn-start:disabled { background: #a8bdfa; cursor: not-allowed; }
        .exmp-btn-region {
          background: #22c55e;
          color: #fff;
        }
        .exmp-btn-region:hover { background: #16a34a; }
        .exmp-btn-region:disabled { background: #86efac; cursor: not-allowed; }
        .exmp-btn-clear {
          background: transparent;
          color: #98a2b3;
        }
        .exmp-btn-clear:hover { background: #f2f4f7; color: #667085; }
        .exmp-btn-settings {
          background: transparent;
          color: #98a2b3;
          font-size: 14px;
          padding: 2px 6px;
          line-height: 1;
        }
        .exmp-btn-settings:hover { background: #f2f4f7; color: #667085; }
        .exmp-btn-mini {
          background: transparent;
          color: #98a2b3;
          font-size: 14px;
          padding: 2px 8px;
          line-height: 1;
        }
        .exmp-btn-mini:hover { background: #f2f4f7; color: #667085; }
        .exmp-btn-back {
          background: transparent;
          color: #4f6ef7;
          font-size: 12px;
          font-weight: 500;
          padding: 5px 13px;
          border: none;
          border-radius: 8px;
          cursor: pointer;
        }
        .exmp-btn-back:hover { background: #f2f4f7; }
        .exmp-status {
          color: #98a2b3;
          flex: 0 0 auto;
          min-height: 26px;
        }
        .exmp-status:empty { display: none; }
        .exmp-content {
          flex: 1 1 auto;
          min-height: 0;
          padding: 8px 14px 10px;
          overflow-y: auto;
          max-height: 360px;
          font-size: 13px;
          line-height: 1.7;
        }
        .exmp-content:empty { display: none; }
        .exmp-answer {
          padding: 10px 12px;
          margin-bottom: 8px;
          background: #f9fafc;
          border-radius: 8px;
          font-size: 12.5px;
          line-height: 1.6;
        }
        .exmp-answer:last-child { margin-bottom: 0; }
        .exmp-error {
          color: #e74c3c;
          padding: 8px 12px;
          background: #fef6f5;
          border-radius: 8px;
          font-size: 12px;
          margin-top: 6px;
        }
        .exmp-loading {
          display: inline-block;
          width: 10px;
          height: 10px;
          border: 1.5px solid #dfe3e9;
          border-top-color: #4f6ef7;
          border-radius: 50%;
          animation: exmp-spin 0.7s linear infinite;
          vertical-align: middle;
        }
        @keyframes exmp-spin {
          to { transform: rotate(360deg); }
        }

        /* ---- Config management view ---- */
        .exmp-config {
          flex: 1 1 auto;
          min-height: 0;
          padding: 8px 14px 10px;
          overflow-y: auto;
          max-height: 360px;
          font-size: 13px;
        }
        .exmp-config-item {
          padding: 8px 10px;
          margin-bottom: 6px;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.15s;
          border: 1px solid #f0f1f3;
        }
        .exmp-config-item:hover { background: #f9fafc; }
        .exmp-config-item.active { border-color: #4f6ef7; background: #f5f7ff; }
        .exmp-config-item-name { font-weight: 600; font-size: 12.5px; color: #213547; }
        .exmp-config-item-detail { font-size: 11px; color: #98a2b3; margin-top: 2px; }
        .exmp-config-item-actions { float: right; display: flex; gap: 2px; }
        .exmp-config-edit-btn {
          background: none;
          border: none;
          color: #98a2b3;
          cursor: pointer;
          font-size: 12px;
          padding: 2px 4px;
          border-radius: 4px;
          line-height: 1;
        }
        .exmp-config-edit-btn:hover { background: #f2f4f7; color: #667085; }
        .exmp-config-delete-btn {
          background: none;
          border: none;
          color: #e74c3c;
          cursor: pointer;
          font-size: 13px;
          padding: 2px 6px;
          border-radius: 4px;
          line-height: 1;
        }
        .exmp-config-delete-btn:hover { background: #fef6f5; }
        .exmp-config-add-btn {
          padding: 8px;
          border: 1px dashed #d0d5dd;
          background: transparent;
          cursor: pointer;
          font-size: 12px;
          color: #667085;
          margin-top: 8px;
        }
        .exmp-config-add-btn:hover { background: #f9fafc; border-color: #98a2b3; }
        .exmp-config-form { margin-top: 8px; }
        .exmp-config-form label {
          display: block;
          font-size: 11px;
          color: #667085;
          margin-bottom: 4px;
          margin-top: 6px;
        }
        .exmp-config-form label:first-child { margin-top: 0; }
        .exmp-section-toggle {
          width: 100%;
          padding: 0;
          border: none;
          background: transparent;
          color: #667085;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-family: inherit;
          font-size: 11px;
          font-weight: 600;
          text-align: left;
        }
        .exmp-section-toggle:focus-visible {
          outline: 2px solid #4f6ef7;
          outline-offset: 2px;
          border-radius: 4px;
        }
        .exmp-config-form input {
          width: 100%;
          padding: 6px 8px;
          border: 1px solid #d0d5dd;
          border-radius: 6px;
          font-size: 12px;
          outline: none;
          box-sizing: border-box;
        }
        .exmp-config-form input:focus { border-color: #4f6ef7; }
        .exmp-config-form select {
          width: 100%;
          padding: 6px 8px;
          border: 1px solid #d0d5dd;
          border-radius: 6px;
          font-size: 12px;
          outline: none;
          box-sizing: border-box;
          background: #fff;
          color: #213547;
        }
        .exmp-config-form select:focus { border-color: #4f6ef7; }
        .exmp-config-form-actions { margin-top: 8px; }
        .exmp-config-save-btn {
          padding: 5px 13px;
          border: none;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 500;
          background: #4f6ef7;
          color: #fff;
          cursor: pointer;
        }
        .exmp-config-save-btn:hover { background: #3b5de7; }
        .exmp-config-cancel-btn {
          padding: 5px 13px;
          border: none;
          border-radius: 8px;
          font-size: 12px;
          background: transparent;
          color: #98a2b3;
          cursor: pointer;
        }
        .exmp-config-cancel-btn:hover { background: #f2f4f7; }
        .exmp-config-error {
          margin-top: 8px;
          padding: 7px 8px;
          border: 1px solid #f9c9c3;
          border-radius: 6px;
          background: #fff5f4;
          color: #b42318;
          font-size: 11px;
          line-height: 1.4;
        }
        .exmp-config-empty {
          text-align: center;
          color: #98a2b3;
          padding: 20px 0;
          font-size: 12px;
        }
        .exmp-transfer {
          border-top: 1px solid #f0f1f3;
          margin-top: 10px;
          padding-top: 10px;
        }
        .exmp-transfer-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
        .exmp-transfer-btn {
          align-items: center;
          background: #fff;
          border: 1px solid #d0d5dd;
          border-radius: 6px;
          color: #344054;
          cursor: pointer;
          display: flex;
          font-family: inherit;
          font-size: 11px;
          justify-content: center;
          min-height: 30px;
          padding: 5px 8px;
        }
        .exmp-transfer-btn:hover { background: #f9fafc; border-color: #98a2b3; }
        .exmp-transfer-btn:disabled { cursor: default; opacity: 0.55; }
        .exmp-transfer-note { color: #b54708; font-size: 10px; line-height: 1.4; margin-top: 6px; }
        .exmp-transfer-message { font-size: 10px; line-height: 1.4; margin-top: 6px; }
        .exmp-transfer-message.success { color: #067647; }
        .exmp-transfer-message.error { color: #b42318; }
        .exmp-ui-settings {
          border-top: 1px solid #f0f1f3;
          margin-top: 10px;
          padding-top: 10px;
        }
        .exmp-ui-settings-title {
          color: #667085;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.3px;
          margin-bottom: 6px;
        }
        .exmp-opacity-label {
          color: #667085;
          display: flex;
          font-size: 11px;
          justify-content: space-between;
          margin-bottom: 4px;
        }
        .exmp-opacity-range {
          accent-color: #4f6ef7;
          display: block;
          min-width: 0;
          width: 100%;
        }
        .exmp-switch-row {
          align-items: center;
          color: #344054;
          display: flex;
          font-size: 12px;
          justify-content: space-between;
          margin-top: 10px;
        }
        .exmp-switch {
          align-items: center;
          appearance: none;
          background: #e4e7ec;
          border: 0;
          border-radius: 999px;
          box-sizing: border-box;
          cursor: pointer;
          display: inline-flex;
          flex: 0 0 auto;
          height: 22px;
          margin: 0;
          padding: 2px;
          transition: background 0.15s;
          width: 40px;
        }
        .exmp-switch.active { background: #4f6ef7; }
        .exmp-switch-knob {
          background: #fff;
          border-radius: 50%;
          box-shadow: 0 1px 2px rgba(16,24,40,0.18);
          height: 18px;
          transform: translateX(0);
          transition: transform 0.15s;
          width: 18px;
        }
        .exmp-switch.active .exmp-switch-knob { transform: translateX(18px); }
        .exmp-number-input {
          border: 1px solid #d0d5dd;
          border-radius: 6px;
          box-sizing: border-box;
          color: #344054;
          font: inherit;
          font-size: 12px;
          height: 28px;
          outline: none;
          padding: 4px 8px;
          text-align: right;
          width: 72px;
        }
        .exmp-number-input:focus {
          border-color: #4f6ef7;
          box-shadow: 0 0 0 2px rgba(79,110,247,0.14);
        }
        .exmp-cursor-style-select {
          background: #fff;
          border: 1px solid #d0d5dd;
          border-radius: 6px;
          box-sizing: border-box;
          color: #344054;
          font: inherit;
          font-size: 12px;
          height: 28px;
          max-width: 148px;
          outline: none;
          padding: 4px 26px 4px 8px;
        }
        .exmp-cursor-style-select:focus {
          border-color: #4f6ef7;
          box-shadow: 0 0 0 2px rgba(79,110,247,0.14);
        }
        .exmp-input-suffix {
          color: #667085;
          font-size: 12px;
          margin-left: 6px;
        }
      </style>

      ${viewState === 'mini' ? html`
        <div
          class="exmp-mini"
          title="拖动可调整位置，点击展开"
          onPointerDown=${handleMiniPointerDown}
          onPointerMove=${handleMiniPointerMove}
          onPointerUp=${handleMiniPointerUp}
          onPointerCancel=${handleMiniPointerCancel}
          onClick=${handleMiniClick}
        >⚡</div>
      ` : html`
        <div class="exmp-panel">
          ${viewState === 'config' ? html`
            <div class="exmp-config" key="config">
              ${configList.length === 0 ? html`
                <div class="exmp-config-empty">暂无配置，请点击下方按钮添加</div>
              ` : configList.map(function (cfg) {
                var urlShort = (cfg.url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
                var modeLabels = { 'responses-api': 'Responses API', 'anthropic': 'Anthropic Claude', 'custom-template': '自定义模板' };
                var modeLabel = modeLabels[cfg.apiMode] || 'Chat Completions';
                var overrideParts = [];
                if (cfg.apiMode === 'custom-template') {
                  if ((cfg.templateHeadersJson || '').trim()) overrideParts.push('headers');
                  if ((cfg.templateBodyJson || '').trim()) overrideParts.push('body');
                  if ((cfg.templateResponseText || '').trim()) overrideParts.push('response');
                } else {
                  if ((cfg.customHeadersJson || '').trim()) overrideParts.push('headers');
                  if ((cfg.customBodyJson || '').trim()) overrideParts.push('body');
                }
                var overrideLabel = overrideParts.length ? overrideParts.join('+') : '无';
                var customLabel = cfg.apiMode === 'custom-template' ? '模板: ' : 'JSON 覆盖: ';
                return html`
                  <div class="exmp-config-item${cfg.selected ? ' active' : ''}" onClick=${function () { selectConfig(cfg.id); }}>
                    <div class="exmp-config-item-actions">
                      <button class="exmp-config-edit-btn" onClick=${function (e) { e.stopPropagation(); openEditForm(cfg.id); }}>✏️</button>
                      <button class="exmp-config-delete-btn" onClick=${function (e) { e.stopPropagation(); deleteConfig(cfg.id); }}>✕</button>
                    </div>
                    <div class="exmp-config-item-name">${cfg.selected ? '● ' : '○ '}${cfg.name || '未命名'}</div>
                    <div class="exmp-config-item-detail">模型: ${cfg.model || '-'} · 模式: ${modeLabel} · ${customLabel}${overrideLabel} · ${urlShort}</div>
                  </div>
                `;
              })}
              ${!showForm ? html`
                <button class="exmp-config-add-btn exmp-w-full exmp-rounded-8" onClick=${openAddForm}>+ 添加新配置</button>
              ` : html`
                <div class="exmp-config-form">
                  <label>配置名称</label>
                  <input value=${formName} onInput=${function (e) { setFormName(e.target.value); }} placeholder="例如: 我的 OpenAI" />
                  <label>接口地址 (URL)</label>
                  <input value=${formUrl} onInput=${function (e) { setFormUrl(e.target.value); }} placeholder=${getApiUrlPlaceholder(formMode)} />
                  <label>接口模式</label>
                  <select value=${formMode} onChange=${function (e) {
                    var newMode = e.target.value;
                    setFormMode(newMode);
                    // Auto-fill Anthropic defaults for new configs
                    if (newMode === 'anthropic' && editingId === null && !formHeadersJson.trim() && !formBodyJson.trim()) {
                      setFormHeadersJson(JSON.stringify({ 'anthropic-version': '2023-06-01' }, null, 2));
                      setFormBodyJson(JSON.stringify({ max_tokens: 4096 }, null, 2));
                    }
                    if (newMode === 'custom-template') {
                      if (!formTemplateHeadersJson.trim()) setFormTemplateHeadersJson(getDefaultTemplateHeadersJson());
                      if (!formTemplateBodyJson.trim()) setFormTemplateBodyJson(getDefaultTemplateBodyJson());
                      if (!formTemplateResponseText.trim()) setFormTemplateResponseText(getDefaultTemplateResponseText());
                      setShowHeadersSection(true);
                      setShowBodySection(true);
                      setShowResponseSection(true);
                    }
                  }}>
                    <option value="chat-completions">OpenAI · Chat Completions</option>
                    <option value="responses-api">OpenAI · Responses API</option>
                    <option value="anthropic">Anthropic · Messages API</option>
                    <option value="custom-template">自定义模板</option>
                  </select>
                  <label>模型名称</label>
                  <input value=${formModel} onInput=${function (e) { setFormModel(e.target.value); }} placeholder="gpt-4o" />
                  <label>API Key</label>
                  <input value=${formKey} onInput=${function (e) { setFormKey(e.target.value); }} type="password" placeholder="sk-..." />
                  ${formMode === 'custom-template' ? html`
                    <div style="margin-top: 8px; border-top: 1px solid #f0f1f3; padding-top: 8px;">
                      <button type="button" class="exmp-section-toggle" onClick=${function () { setShowHeadersSection(!showHeadersSection); }}>
                        <span>Headers 模板</span>
                        <span style="font-size: 10px; color: #98a2b3;">${showHeadersSection ? '收起 ▲' : '展开 ▼'}</span>
                      </button>
                      ${showHeadersSection ? html`
                        <textarea
                          value=${formTemplateHeadersJson}
                          onInput=${function (e) { setFormTemplateHeadersJson(e.target.value); }}
                          placeholder=${getDefaultTemplateHeadersJson()}
                          spellcheck="false"
                          style="width: 100%; margin-top: 6px; min-height: 82px; padding: 8px; border: 1px solid #d0d5dd; border-radius: 6px; font-size: 11px; outline: none; resize: vertical; box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45;"
                        ></textarea>
                      ` : ''}
                    </div>
                    <div style="margin-top: 8px; border-top: 1px solid #f0f1f3; padding-top: 8px;">
                      <button type="button" class="exmp-section-toggle" onClick=${function () { setShowBodySection(!showBodySection); }}>
                        <span>Body 模板</span>
                        <span style="font-size: 10px; color: #98a2b3;">${showBodySection ? '收起 ▲' : '展开 ▼'}</span>
                      </button>
                      ${showBodySection ? html`
                        <textarea
                          value=${formTemplateBodyJson}
                          onInput=${function (e) { setFormTemplateBodyJson(e.target.value); }}
                          placeholder=${getDefaultTemplateBodyJson()}
                          spellcheck="false"
                          style="width: 100%; margin-top: 6px; min-height: 148px; padding: 8px; border: 1px solid #d0d5dd; border-radius: 6px; font-size: 11px; outline: none; resize: vertical; box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45;"
                        ></textarea>
                      ` : ''}
                    </div>
                    <div style="margin-top: 8px; border-top: 1px solid #f0f1f3; padding-top: 8px;">
                      <button type="button" class="exmp-section-toggle" onClick=${function () { setShowResponseSection(!showResponseSection); }}>
                        <span>响应模板</span>
                        <span style="font-size: 10px; color: #98a2b3;">${showResponseSection ? '收起 ▲' : '展开 ▼'}</span>
                      </button>
                      ${showResponseSection ? html`
                        <textarea
                          value=${formTemplateResponseText}
                          onInput=${function (e) { setFormTemplateResponseText(e.target.value); }}
                          placeholder=${getDefaultTemplateResponseText()}
                          spellcheck="false"
                          style="width: 100%; margin-top: 6px; min-height: 58px; padding: 8px; border: 1px solid #d0d5dd; border-radius: 6px; font-size: 11px; outline: none; resize: vertical; box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45;"
                        ></textarea>
                      ` : ''}
                    </div>
                  ` : html`
                    <div style="margin-top: 8px; border-top: 1px solid #f0f1f3; padding-top: 8px;">
                      <button type="button" class="exmp-section-toggle" onClick=${function () { setShowHeadersSection(!showHeadersSection); }}>
                        <span>Headers JSON 覆盖</span>
                        <span style="font-size: 10px; color: #98a2b3;">${showHeadersSection ? '收起 ▲' : '展开 ▼'}</span>
                      </button>
                      ${showHeadersSection ? html`
                        <textarea
                          value=${formHeadersJson}
                          onInput=${function (e) { setFormHeadersJson(e.target.value); }}
                          placeholder=${'{\n  "OpenAI-Organization": "org_xxx"\n}'}
                          spellcheck="false"
                          style="width: 100%; margin-top: 6px; min-height: 82px; padding: 8px; border: 1px solid #d0d5dd; border-radius: 6px; font-size: 11px; outline: none; resize: vertical; box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45;"
                        ></textarea>
                      ` : ''}
                    </div>
                    <div style="margin-top: 8px; border-top: 1px solid #f0f1f3; padding-top: 8px;">
                      <button type="button" class="exmp-section-toggle" onClick=${function () { setShowBodySection(!showBodySection); }}>
                        <span>Body JSON 覆盖</span>
                        <span style="font-size: 10px; color: #98a2b3;">${showBodySection ? '收起 ▲' : '展开 ▼'}</span>
                      </button>
                      ${showBodySection ? html`
                        <textarea
                          value=${formBodyJson}
                          onInput=${function (e) { setFormBodyJson(e.target.value); }}
                          placeholder=${'{\n  "temperature": 0,\n  "max_tokens": 4096,\n  "metadata": { "source": "exampilot" }\n}'}
                          spellcheck="false"
                          style="width: 100%; margin-top: 6px; min-height: 116px; padding: 8px; border: 1px solid #d0d5dd; border-radius: 6px; font-size: 11px; outline: none; resize: vertical; box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45;"
                        ></textarea>
                      ` : ''}
                    </div>
                  `}
                  <div style="margin-top: 8px; border-top: 1px solid #f0f1f3; padding-top: 8px;">
                    <button type="button" class="exmp-section-toggle" onClick=${function () { setShowPreview(!showPreview); }}>
                      <span>📋 请求预览</span>
                      <span style="font-size: 10px; color: #98a2b3;">${showPreview ? '收起 ▲' : '展开 ▼'}</span>
                    </button>
                    ${showPreview ? html`
                      <div style="margin-top: 6px;">
                        <div style="font-size: 10px; font-weight: 600; color: #667085; margin-bottom: 4px;">Headers 预览:</div>
                        <pre style="background: #f5f7fa; border-radius: 6px; padding: 8px; font-size: 10px; line-height: 1.5; overflow-x: auto; white-space: pre-wrap; word-break: break-all; margin: 0;">
${function () {
  try {
    return JSON.stringify(buildPreviewHeaders(), null, 2);
  } catch (err) {
    return err.message || String(err);
  }
}()}
                        </pre>
                      </div>
                      <div style="margin-top: 6px;">
                        <div style="font-size: 10px; font-weight: 600; color: #667085; margin-bottom: 4px;">Body 预览:</div>
                        <pre style="background: #f5f7fa; border-radius: 6px; padding: 8px; font-size: 10px; line-height: 1.5; overflow-x: auto; white-space: pre-wrap; word-break: break-all; margin: 0;">
${function () {
  try {
    return JSON.stringify(buildPreviewBody(), null, 2);
  } catch (err) {
    return err.message || String(err);
  }
}()}
                        </pre>
                      </div>
                      ${formMode === 'custom-template' ? html`
                        <div style="margin-top: 6px;">
                          <div style="font-size: 10px; font-weight: 600; color: #667085; margin-bottom: 4px;">响应模板:</div>
                          <pre style="background: #f5f7fa; border-radius: 6px; padding: 8px; font-size: 10px; line-height: 1.5; overflow-x: auto; white-space: pre-wrap; word-break: break-all; margin: 0;">${formTemplateResponseText || getDefaultTemplateResponseText()}</pre>
                        </div>
                      ` : ''}
                    ` : ''}
                  </div>
                  ${formError ? html`<div class="exmp-config-error">${formError}</div>` : ''}
                  <div class="exmp-config-form-actions exmp-flex exmp-gap-6">
                    <button class="exmp-config-save-btn" disabled=${configSaving} onClick=${saveForm}>${configSaving ? '授权中...' : (editingId ? '更新' : '保存')}</button>
                    <button class="exmp-config-cancel-btn" onClick=${cancelForm}>取消</button>
                  </div>
                </div>
              `}
              <div class="exmp-transfer">
                <div class="exmp-ui-settings-title">配置迁移</div>
                <div class="exmp-transfer-actions">
                  <button
                    class="exmp-transfer-btn"
                    disabled=${transferBusy}
                    title="导出全部 ExamPilot 配置"
                    onClick=${exportSettings}
                  >↓ 导出配置</button>
                  <button
                    class="exmp-transfer-btn"
                    disabled=${transferBusy}
                    title="从 ExamPilot 配置文件导入"
                    onClick=${chooseImportFile}
                  >↑ 导入配置</button>
                </div>
                <input
                  ref=${importInputRef}
                  type="file"
                  accept="application/json,.json"
                  style="display: none;"
                  onChange=${importSettings}
                />
                <div class="exmp-transfer-note">导出文件包含 API Key，请勿分享或上传到公共位置。</div>
                ${transferMessage ? html`
                  <div class="exmp-transfer-message ${transferMessage.type}">${transferMessage.text}</div>
                ` : ''}
              </div>
              <div class="exmp-ui-settings">
                <div class="exmp-ui-settings-title">🎨 界面设置</div>
                <label class="exmp-opacity-label" for="exmp-opacity-range">
                  <span>界面透明度</span>
                  <span>${Math.round(uiOpacity * 100)}%</span>
                </label>
                <input
                  id="exmp-opacity-range"
                  class="exmp-opacity-range"
                  type="range"
                  min="0.01"
                  max="1"
                  step="0.01"
                  value=${uiOpacity}
                  onInput=${function (e) { saveUiOpacity(e.target.value); }}
                />
              </div>
              <div style="border-top: 1px solid #f0f1f3; margin-top: 10px; padding-top: 10px;">
                <div style="font-size: 12px; font-weight: 600; color: #667085; letter-spacing: 0.3px; margin-bottom: 6px;">📝 普通提示词</div>
                <textarea
                  value=${customPrompt}
                  onInput=${function (e) { setCustomPrompt(e.target.value); }}
                  style="width: 100%; padding: 8px; border: 1px solid #d0d5dd; border-radius: 6px; font-size: 12px; outline: none; resize: vertical; min-height: 100px; box-sizing: border-box; font-family: inherit; line-height: 1.5;"
                  placeholder="输入普通模式提示词..."
                ></textarea>
                <div class="exmp-config-form-actions exmp-flex exmp-gap-6" style="margin-top: 6px;">
                  <button class="exmp-config-save-btn" disabled=${promptSaving} onClick=${savePrompt}>${promptSaving ? '保存中...' : '保存提示词'}</button>
                </div>
              </div>
              <div class="exmp-ui-settings">
                <div class="exmp-ui-settings-title">静默设置</div>
                <div class="exmp-switch-row">
                  <span>静默模式</span>
                  <button
                    type="button"
                    class="exmp-switch${silentModeEnabled ? ' active' : ''}"
                    aria-pressed=${silentModeEnabled ? 'true' : 'false'}
                    title="开启后使用答案坐标进行悬停反馈"
                    onClick=${function () { saveSilentMode(!silentModeEnabled); }}
                  >
                    <span class="exmp-switch-knob"></span>
                  </button>
                </div>
                ${silentModeEnabled ? html`
                  <label class="exmp-switch-row" for="exmp-fake-cursor-size">
                    <span>仿光标大小</span>
                    <span class="exmp-flex exmp-items-center">
                      <input
                        id="exmp-fake-cursor-size"
                        class="exmp-number-input"
                        type="number"
                        min="10"
                        max="32"
                        step="1"
                        value=${fakeCursorSize}
                        onChange=${function (e) { saveFakeCursorSize(e.target.value); }}
                      />
                      <span class="exmp-input-suffix">px</span>
                    </span>
                  </label>
                  <label class="exmp-switch-row" for="exmp-fake-cursor-style">
                    <span>仿光标样式</span>
                    <select
                      id="exmp-fake-cursor-style"
                      class="exmp-cursor-style-select"
                      value=${fakeCursorStyle}
                      onChange=${function (e) { saveFakeCursorStyle(e.target.value); }}
                    >
                      <option value="dark-outline">MacOS 黑色白边</option>
                      <option value="light-outline">Windows · 白色黑边</option>
                    </select>
                  </label>
                  <div class="exmp-switch-row">
                    <span>显示静默框</span>
                    <button
                      type="button"
                      class="exmp-switch${silentDebugFrameEnabled ? ' active' : ''}"
                      aria-pressed=${silentDebugFrameEnabled ? 'true' : 'false'}
                      title="开启后在页面上显示 AI 返回的答案区域"
                      onClick=${function () { saveSilentDebugFrame(!silentDebugFrameEnabled); }}
                    >
                      <span class="exmp-switch-knob"></span>
                    </button>
                  </div>
                ` : ''}
              </div>
              ${silentModeEnabled ? html`
                <div style="border-top: 1px solid #f0f1f3; margin-top: 10px; padding-top: 10px;">
                  <div style="font-size: 12px; font-weight: 600; color: #667085; letter-spacing: 0.3px; margin-bottom: 6px;">静默提示词</div>
                  <textarea
                    value=${silentPrompt}
                    onInput=${function (e) { setSilentPrompt(e.target.value); }}
                    style="width: 100%; padding: 8px; border: 1px solid #d0d5dd; border-radius: 6px; font-size: 12px; outline: none; resize: vertical; min-height: 150px; box-sizing: border-box; font-family: inherit; line-height: 1.5;"
                    placeholder=${DEFAULT_SILENT_PROMPT}
                  ></textarea>
                  <div class="exmp-config-form-actions exmp-flex exmp-gap-6" style="margin-top: 6px;">
                    <button class="exmp-config-save-btn" disabled=${silentPromptSaving} onClick=${saveSilentPrompt}>${silentPromptSaving ? '保存中...' : '保存静默提示词'}</button>
                    <button class="exmp-config-cancel-btn" type="button" disabled=${silentPromptSaving} onClick=${function () { setSilentPrompt(DEFAULT_SILENT_PROMPT); }}>恢复默认</button>
                  </div>
                </div>
              ` : ''}
            </div>
          ` : html`
            <div class="exmp-content" key="content">
              ${answers.length === 0 ? '' : answers.map(function (a) {
                if (a.type === 'answer') {
                  return html`<div class="exmp-answer" dangerouslySetInnerHTML=${{ __html: sanitizeAnswerHtml(a.content) }} />`;
                }
                return html`<div class="exmp-error">${a.content}</div>`;
              })}
            </div>
          `}

          <div class="exmp-status exmp-flex exmp-items-center exmp-gap-6 exmp-p-6-14 exmp-text-11">
            ${showSpinner ? html`<span class="exmp-loading"></span>` : ''}${statusText}
          </div>

          <div class="exmp-footer exmp-flex exmp-items-center exmp-justify-between exmp-gap-6 exmp-p-8-14">
            <span class="exmp-title">⚡ ExamPilot AI</span>
            <div class="exmp-buttons exmp-flex exmp-items-center exmp-gap-6">
              ${viewState === 'config' ? html`
                <button class="exmp-btn exmp-btn-back" onClick=${function () { setViewState('main'); }}>← 返回</button>
              ` : html`
                ${capturing || selectingRegion ? html`
                  <button class="exmp-btn exmp-btn-clear" onClick=${handleCancelOrClear}>取消</button>
                ` : html`
                  <button class="exmp-btn exmp-btn-start" onClick=${handleFullscreenCapture}>全屏</button>
                  <button class="exmp-btn exmp-btn-region" onClick=${handleRegionCapture}>区域</button>
                  <button class="exmp-btn exmp-btn-clear" onClick=${handleCancelOrClear}>清除</button>
                `}
                <button class="exmp-btn exmp-btn-settings" onClick=${openConfigView}>⚙️</button>
                <button class="exmp-btn exmp-btn-mini" onClick=${function () { setViewState('mini'); }}>—</button>
              `}
            </div>
          </div>
        </div>
      `}
    `;
  }

  render(html`<${Panel} />`, shadow);
}
