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
var __permissionHandler = null;
var DEFAULT_SILENT_SCROLL_PIXELS = 5;
var DEFAULT_SILENT_PROMPT = '请识别图片中所有完整显示的题目。只返回一个 JSON 对象，不要使用 Markdown 代码块，不要输出多余文字。\n' +
  '不要定位到题干空白、横线、输入框、解析区域或未完整显示的题目。\n' +
  '选择题必须返回正确选项本身的位置：bboxPercent 要框住正确选项行，至少包含选项字母圆圈和选项文本；coordinatePercent 要落在这个 bboxPercent 内。\n' +
  '简答题、填空题、编程题等没有可悬浮正确选项的题目，不要编造坐标，只返回答案文本，并设置 "clipboardOnly": true。\n' +
  '如果编程题已经给定了部分代码、函数签名、类定义、输入输出处理或注释要求，请在已有内容基础上补全，不要重写无关结构，不要删除题目给定的代码。\n' +
  'JSON 格式必须为：{"items":[{"questionNumber":"题号","answer":"正确答案文本","choice":"A/B/C/D 等选项字母","coordinatePercent":{"x":0到1的小数,"y":0到1的小数},"bboxPercent":{"x":0到1的小数,"y":0到1的小数,"width":0到1的小数,"height":0到1的小数}},{"questionNumber":"题号","answer":"简答/编程题答案文本","clipboardOnly":true}]}';

function normalizeSilentScrollPixels(value) {
  var number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_SILENT_SCROLL_PIXELS;
  return Math.max(0, Math.min(Math.round(number), 200));
}

function getApiUrlPlaceholder(apiMode) {
  var placeholders = {
    'chat-completions': 'https://api.openai.com/v1/chat/completions',
    'responses-api': 'https://api.openai.com/v1/responses',
    'anthropic': 'https://api.anthropic.com/v1/messages',
    'custom-template': 'https://api.example.com/v1/analyze'
  };
  return placeholders[apiMode] || placeholders['chat-completions'];
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
    var silentModeState = useState(false), silentModeEnabled = silentModeState[0], setSilentModeEnabled = silentModeState[1];
    var silentScrollState = useState(DEFAULT_SILENT_SCROLL_PIXELS), silentScrollPixels = silentScrollState[0], setSilentScrollPixels = silentScrollState[1];
    var silentDebugFrameState = useState(false), silentDebugFrameEnabled = silentDebugFrameState[0], setSilentDebugFrameEnabled = silentDebugFrameState[1];
    var transferBusyState = useState(false), transferBusy = transferBusyState[0], setTransferBusy = transferBusyState[1];
    var transferMessageState = useState(null), transferMessage = transferMessageState[0], setTransferMessage = transferMessageState[1];
    var positionState = useState(null), panelPosition = positionState[0], setPanelPosition = positionState[1];
    var hiddenByUserRef = useRef(false);
    var currentRequestSeqRef = useRef(0);
    var miniDragRef = useRef(null);
    var suppressMiniClickRef = useRef(false);
    var importInputRef = useRef(null);
    var silentTargetRef = useRef(null);
    var silentHoverTimerRef = useRef(null);
    var silentHoverTargetRef = useRef(null);
    var silentScrollPixelsRef = useRef(DEFAULT_SILENT_SCROLL_PIXELS);
    var silentDebugFrameEnabledRef = useRef(false);

    // 区域选择相关状态
    var _w = useState(false), selectingRegion = _w[0], setSelectingRegion = _w[1];
    var overlayElRef = useRef(null);

    silentScrollPixelsRef.current = silentScrollPixels;
    silentDebugFrameEnabledRef.current = silentDebugFrameEnabled;

    function handleCaptureResponse(response, mySeq) {
      if (mySeq !== currentRequestSeqRef.current) return;
      if (!response.success) {
        setStatusText('处理失败');
        setShowSpinner(false);
        setAnswers(function (prev) { return prev.concat([{ type: 'error', content: '❌ ' + (response.error || '未知错误') }]); });
      } else {
        setStatusText('识别完成');
        setShowSpinner(false);
        if (response.result && response.result.mode === 'silent') {
          installSilentTarget(response.result);
          window.scrollBy(0, silentScrollPixelsRef.current);
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
      removeSilentTarget();
      setStatusText('处理失败');
      setShowSpinner(false);
      setAnswers(function (prev) { return prev.concat([{ type: 'error', content: '❌ ' + (error.message || String(error)) }]); });
    }

    function handleCaptureFinally(mySeq) {
      if (mySeq === currentRequestSeqRef.current) {
        setCapturing(false);
      }
    }

    // ---- Listen for status messages from background ----
    useEffect(function () {
      function handler(request) {
        if (request.action === 'status') {
          if (request.message === '截图中...') {
            host.style.display = 'none';
          } else {
            if (host.style.display === 'none' && !hiddenByUserRef.current) {
              host.style.display = '';
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

    // ---- Listen for toggle-panel custom event ----
    useEffect(function () {
      function handler() {
        if (host.style.display === 'none') {
          host.style.display = '';
          hiddenByUserRef.current = false;
        } else {
          host.style.display = 'none';
          hiddenByUserRef.current = true;
        }
      }
      host.addEventListener('toggle-panel', handler);
      return function () { host.removeEventListener('toggle-panel', handler); };
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

    function loadSilentMode() {
      chrome.runtime.sendMessage({ action: 'getSilentMode' }).then(function (res) {
        if (res && res.success) {
          setSilentModeEnabled(res.silentModeEnabled === true);
          setSilentScrollPixels(normalizeSilentScrollPixels(res.silentScrollPixels));
          setSilentDebugFrameEnabled(res.silentDebugFrameEnabled === true);
        }
      }).catch(function () {});
    }

    function saveSilentMode(value) {
      var enabled = value === true;
      setSilentModeEnabled(enabled);
      chrome.runtime.sendMessage({
        action: 'setSilentMode',
        silentModeEnabled: enabled
      }).catch(function () {
        setSilentModeEnabled(!enabled);
      });
    }

    function saveSilentScrollPixels(value) {
      var normalized = normalizeSilentScrollPixels(value);
      setSilentScrollPixels(normalized);
      chrome.runtime.sendMessage({
        action: 'setSilentScrollPixels',
        silentScrollPixels: normalized
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

    function showApiHostPermissionFrame(origin) {
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
        iframe.src = chrome.runtime.getURL('permission/host-permission.html?embed=1&origin=' + encodeURIComponent(origin));
        iframe.style.cssText = 'width: 100%; height: 100%; border: 0; display: block;';
        iframe.setAttribute('title', 'ExamPilot API 域名授权');

        function cleanup(result) {
          window.removeEventListener('message', handleMessage);
          __permissionHandler = null;
          if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
          }
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

    function ensureActiveConfigPermissionBeforeCapture() {
      return chrome.runtime.sendMessage({ action: 'getConfigs' }).then(function (res) {
        if (!res.success) {
          throw new Error(res.error || '读取配置失败');
        }
        var list = res.configList || [];
        var selected = list.find(function (cfg) { return cfg.selected; });
        if (!selected) {
          throw new Error('请先点击 ⚙️ 选择 AI 配置');
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

      checkApiHostPermission(formUrl).then(function (res) {
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
      }).catch(function (error) {
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

    function removeSilentTarget() {
      clearSilentHoverTimer();
      var state = silentTargetRef.current;
      var states = Array.isArray(state) ? state : (state ? [state] : []);
      states.forEach(function (item) {
        if (!item) return;
        window.removeEventListener('scroll', item.updatePosition, true);
        window.removeEventListener('resize', item.updatePosition, true);
        document.removeEventListener('mousemove', item.handleMouseMove, true);
        if (item.el && item.el.parentNode) {
          item.el.parentNode.removeChild(item.el);
        }
      });
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
        },
        handleMouseMove: function (event) {
          if (!state.containsPoint(event.clientX, event.clientY)) {
            state.isHovering = false;
            state.hoverTriggered = false;
            if (silentHoverTargetRef.current === state) {
              clearSilentHoverTimer();
            }
            return;
          }
          if (state.isHovering && state.hoverTriggered) return;
          if (silentHoverTimerRef.current && silentHoverTargetRef.current === state) return;
          state.isHovering = true;
          clearSilentHoverTimer();
          silentHoverTargetRef.current = state;
          silentHoverTimerRef.current = window.setTimeout(function () {
            silentHoverTimerRef.current = null;
            silentHoverTargetRef.current = null;
            if (!state.isHovering || state.hoverTriggered) return;
            state.hoverTriggered = true;
            window.scrollBy(0, silentScrollPixelsRef.current);
            setStatusText('静默模式已触发');
          }, 350);
        }
      };

      document.body.appendChild(el);
      state.updateVisualState(silentDebugFrameEnabledRef.current);
      state.updatePosition();
      window.addEventListener('scroll', state.updatePosition, true);
      window.addEventListener('resize', state.updatePosition, true);
      document.addEventListener('mousemove', state.handleMouseMove, true);
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
    }

    function handleFullscreenCapture() {
      currentRequestSeqRef.current++;
      var mySeq = currentRequestSeqRef.current;
      removeSilentTarget();
      setCapturing(true);
      setStatusText('准备中...');
      setShowSpinner(true);

      ensureActiveConfigPermissionBeforeCapture().then(function (ok) {
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

      ensureActiveConfigPermissionBeforeCapture().then(function (ok) {
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

      ensureActiveConfigPermissionBeforeCapture().then(function (ok) {
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
                <label class="exmp-switch-row" for="exmp-silent-scroll-pixels">
                  <span>静默滚动距离</span>
                  <span class="exmp-flex exmp-items-center">
                    <input
                      id="exmp-silent-scroll-pixels"
                      class="exmp-number-input"
                      type="number"
                      min="0"
                      max="200"
                      step="1"
                      value=${silentScrollPixels}
                      onChange=${function (e) { saveSilentScrollPixels(e.target.value); }}
                    />
                    <span class="exmp-input-suffix">px</span>
                  </span>
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
