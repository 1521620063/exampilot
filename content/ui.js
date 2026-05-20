/**
 * ExamPilot Floating Panel — Preact + htm with Shadow DOM
 *
 * Shadow DOM via attachShadow() on a plain <div> (no custom elements).
 * No JSX transform needed — htm provides tagged template syntax.
 */

import { render, h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

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
    var _p = useState(''), formHeadersJson = _p[0], setFormHeadersJson = _p[1];
    var _q = useState(''), formBodyJson = _q[0], setFormBodyJson = _q[1];
    var _r = useState(false), showHeadersSection = _r[0], setShowHeadersSection = _r[1];
    var _s = useState(false), showBodySection = _s[0], setShowBodySection = _s[1];
    var _t = useState(false), showPreview = _t[0], setShowPreview = _t[1];
    var _u = useState(''), formError = _u[0], setFormError = _u[1];
    var _v = useState(false), configSaving = _v[0], setConfigSaving = _v[1];
    var hiddenByUserRef = useRef(false);
    var currentRequestSeqRef = useRef(0);

    // 区域选择相关状态
    var _w = useState(false), selectingRegion = _w[0], setSelectingRegion = _w[1];
    var overlayElRef = useRef(null);

    // ---- 共享响应处理（消除全屏识别和区域识别的重复逻辑）----
    function handleCaptureResponse(response, mySeq) {
      if (mySeq !== currentRequestSeqRef.current) return;
      if (!response.success) {
        setStatusText('处理失败');
        setShowSpinner(false);
        setAnswers(function (prev) { return prev.concat([{ type: 'error', content: '❌ ' + (response.error || '未知错误') }]); });
      } else {
        setStatusText('识别完成');
        setShowSpinner(false);
        setAnswers(function (prev) { return prev.concat([{ type: 'answer', content: response.result }]); });
      }
    }

    function handleCaptureError(error, mySeq) {
      if (mySeq !== currentRequestSeqRef.current) return;
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
        }
      }
      chrome.runtime.onMessage.addListener(handler);
      return function () { chrome.runtime.onMessage.removeListener(handler); };
    }, []);

    // ---- Listen for toggle-panel custom event ----
    useEffect(function () {
      function handler() {
        if (host.style.display === 'none') {
          host.style.display = '';
          hiddenByUserRef.current = false;
          setViewState('mini');
        } else {
          host.style.display = 'none';
          hiddenByUserRef.current = true;
        }
      }
      host.addEventListener('toggle-panel', handler);
      return function () { host.removeEventListener('toggle-panel', handler); };
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
    function loadConfigs() {
      chrome.runtime.sendMessage({ action: 'getConfigs' }).then(function (res) {
        if (res.success) setConfigList(res.configList || []);
      });
    }

    function loadPrompt() {
      chrome.runtime.sendMessage({ action: 'getPrompt' }).then(function (res) {
        if (res.success) setCustomPrompt(res.prompt || '');
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

    function selectConfig(id) {
      chrome.runtime.sendMessage({ action: 'setActiveConfig', configId: id }).then(loadConfigs);
    }

    function deleteConfig(id) {
      chrome.runtime.sendMessage({ action: 'deleteConfig', configId: id }).then(loadConfigs);
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
      setShowHeadersSection(false);
      setShowBodySection(false);
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
          setShowHeadersSection(false);
          setShowBodySection(false);
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

    function isPlainJsonObject(value) {
      return Object.prototype.toString.call(value) === '[object Object]';
    }

    function cloneJson(value) {
      if (value === undefined) return undefined;
      return JSON.parse(JSON.stringify(value));
    }

    function mergeJsonOverride(base, override) {
      var result = isPlainJsonObject(base) ? cloneJson(base) : {};
      var patch = isPlainJsonObject(override) ? override : {};
      Object.keys(patch).forEach(function (key) {
        var value = patch[key];
        if (value === null) {
          delete result[key];
          return;
        }
        if (isPlainJsonObject(value) && isPlainJsonObject(result[key])) {
          result[key] = mergeJsonOverride(result[key], value);
          return;
        }
        result[key] = cloneJson(value);
      });
      return result;
    }

    function parseJsonObjectInput(rawValue, label) {
      var text = (rawValue || '').trim();
      if (!text) return {};
      var parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error(label + ' 不是有效的 JSON: ' + (err.message || String(err)));
      }
      if (!isPlainJsonObject(parsed)) {
        throw new Error(label + ' 必须是 JSON 对象');
      }
      return parsed;
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
      var previewHeaders = {
        'Content-Type': 'application/json'
      };
      if (formMode === 'anthropic') {
        previewHeaders['x-api-key'] = formKey ? formKey : '(未设置)';
      } else {
        previewHeaders['Authorization'] = formKey ? 'Bearer ' + formKey : '(未设置)';
      }
      return maskPreviewHeaders(mergeJsonOverride(previewHeaders, parseJsonObjectInput(formHeadersJson, 'Headers JSON')));
    }

    function buildPreviewBody() {
      var previewBody = { model: formModel || '(未设置)' };
      if (formMode === 'responses-api') {
        previewBody.input = [{ role: 'user', content: [{ type: 'input_image', image_url: '<base64_image>' }, { type: 'input_text', text: '<prompt>' }] }];
      } else if (formMode === 'anthropic') {
        previewBody.messages = [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '<base64_image>' } }, { type: 'text', text: '<prompt>' }] }];
      } else {
        previewBody.messages = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: '<base64_image>' } }, { type: 'text', text: '<prompt>' }] }];
      }
      return mergeJsonOverride(previewBody, parseJsonObjectInput(formBodyJson, 'Body JSON'));
    }

    function saveForm() {
      if (!formName || !formUrl || !formModel || !formKey) return;
      setFormError('');
      setConfigSaving(true);

      try {
        parseJsonObjectInput(formHeadersJson, 'Headers JSON');
        parseJsonObjectInput(formBodyJson, 'Body JSON');
      } catch (error) {
        setFormError(error.message || String(error));
        setConfigSaving(false);
        return;
      }

      var action = editingId ? 'editConfig' : 'addConfig';
      var payload = editingId
        ? { action: action, configId: editingId, config: { name: formName, url: formUrl, model: formModel, apiKey: formKey, apiMode: formMode, customHeadersJson: formHeadersJson, customBodyJson: formBodyJson } }
        : { action: action, config: { name: formName, url: formUrl, model: formModel, apiKey: formKey, apiMode: formMode, customHeadersJson: formHeadersJson, customBodyJson: formBodyJson } };

      checkApiHostPermission(formUrl).then(function (res) {
        if (!res.success) {
          throw new Error(res.error || '授权检查失败');
        }
        if (!res.granted) {
          setFormError('需要先授权访问 ' + res.origin + '。请在当前页面完成授权。');
          return showApiHostPermissionFrame(res.origin).then(function (granted) {
            if (!granted) {
              return { success: true, pendingPermission: true };
            }
            return saveConfigPayload(payload).then(function () {
              return { success: true, pendingPermission: true };
            });
          });
        }
        return saveConfigPayload(payload);
      }).then(function (res) {
        if (!res || res.pendingPermission) return;
      }).catch(function (error) {
        setFormError(error.message || String(error));
      }).then(function () {
        setConfigSaving(false);
      });
    }

    // ---- Capture handlers ----
    // 全屏识别：逻辑与原有 handleStartCapture 一致
    function handleFullscreenCapture() {
      currentRequestSeqRef.current++;
      var mySeq = currentRequestSeqRef.current;
      setCapturing(true);
      setStatusText('准备中...');
      setShowSpinner(true);

      ensureActiveConfigPermissionBeforeCapture().then(function (ok) {
        if (!ok) return null;
        return chrome.runtime.sendMessage({ action: 'captureAndAnalyze' });
      }).then(function (response) {
        if (!response) return;
        handleCaptureResponse(response, mySeq);
      }).catch(function (error) {
        handleCaptureError(error, mySeq);
      }).then(function () {
        handleCaptureFinally(mySeq);
      });
    }

    // 区域识别：隐藏面板，进入区域选择模式
    function handleRegionCapture() {
      currentRequestSeqRef.current++;
      var mySeq = currentRequestSeqRef.current;
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
      setCapturing(false);
      setShowSpinner(false);
      setStatusText('已取消');
      chrome.runtime.sendMessage({ action: 'cancelCapture' }).catch(function () {});
    }

    // 取消区域选择，恢复面板
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

    // 鼠标按下：记录选区起点，显示选区矩形框
    function handleSelectionMouseDown(e) {
      e.preventDefault();
      e.stopPropagation();
      // 直接操作 overlay 内的矩形框 DOM
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

    // 鼠标移动：更新选区矩形框
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

    // 鼠标松开：确认选区并开始识别
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

      // 清理选区状态，遮罩由 useEffect 清理
      setSelectingRegion(false);
      removeRegionOverlay();

      // 检查最小尺寸
      var MIN_SIZE = 20;
      if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
        setStatusText('');
        host.style.display = '';
        hiddenByUserRef.current = false;
        setViewState('main');
        return;
      }

      // 恢复面板
      host.style.display = '';
      hiddenByUserRef.current = false;

      // 发起带裁剪坐标的识别请求
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
          rect: rect
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
      setAnswers([]);
      setStatusText('');
    }

    function openConfigView() {
      loadConfigs();
      loadPrompt();
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
          align-items: flex-end;
          position: fixed !important;
          bottom: 24px !important;
          right: 24px !important;
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
          width: 360px;
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
          cursor: pointer;
          box-shadow: 0 2px 12px rgba(79,110,247,0.35);
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .exmp-mini:hover {
          transform: scale(1.1);
          box-shadow: 0 4px 16px rgba(79,110,247,0.45);
        }
        .exmp-footer {
          border-top: 1px solid #f0f1f3;
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
          min-height: 26px;
        }
        .exmp-status:empty { display: none; }
        .exmp-content {
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
      </style>

      ${viewState === 'mini' ? html`
        <div class="exmp-mini" onClick=${function () { setViewState('main'); }}>⚡</div>
      ` : html`
        <div class="exmp-panel">
          ${viewState === 'config' ? html`
            <div class="exmp-config">
              ${configList.length === 0 ? html`
                <div class="exmp-config-empty">暂无配置，请点击下方按钮添加</div>
              ` : configList.map(function (cfg) {
                var urlShort = (cfg.url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
                var modeLabel = cfg.apiMode === 'responses-api' ? 'Responses API' : cfg.apiMode === 'anthropic' ? 'Anthropic Claude' : 'Chat Completions';
                var overrideParts = [];
                if ((cfg.customHeadersJson || '').trim()) overrideParts.push('headers');
                if ((cfg.customBodyJson || '').trim()) overrideParts.push('body');
                var overrideLabel = overrideParts.length ? overrideParts.join('+') : '无';
                return html`
                  <div class="exmp-config-item${cfg.selected ? ' active' : ''}" onClick=${function () { selectConfig(cfg.id); }}>
                    <div class="exmp-config-item-actions">
                      <button class="exmp-config-edit-btn" onClick=${function (e) { e.stopPropagation(); openEditForm(cfg.id); }}>✏️</button>
                      <button class="exmp-config-delete-btn" onClick=${function (e) { e.stopPropagation(); deleteConfig(cfg.id); }}>✕</button>
                    </div>
                    <div class="exmp-config-item-name">${cfg.selected ? '● ' : '○ '}${cfg.name || '未命名'}</div>
                    <div class="exmp-config-item-detail">模型: ${cfg.model} · 模式: ${modeLabel} · JSON 覆盖: ${overrideLabel} · ${urlShort}</div>
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
                  <input value=${formUrl} onInput=${function (e) { setFormUrl(e.target.value); }} placeholder="https://api.openai.com/v1/chat/completions" />
                  <label>接口模式</label>
                  <select value=${formMode} onChange=${function (e) {
                    var newMode = e.target.value;
                    setFormMode(newMode);
                    // Auto-fill Anthropic defaults for new configs
                    if (newMode === 'anthropic' && editingId === null && !formHeadersJson.trim() && !formBodyJson.trim()) {
                      setFormHeadersJson(JSON.stringify({ 'anthropic-version': '2023-06-01' }, null, 2));
                      setFormBodyJson(JSON.stringify({ max_tokens: 4096 }, null, 2));
                    }
                  }}>
                    <option value="chat-completions">OpenAI · Chat Completions</option>
                    <option value="responses-api">OpenAI · Responses API</option>
                    <option value="anthropic">Anthropic · Messages API</option>
                  </select>
                  <label>模型名称</label>
                  <input value=${formModel} onInput=${function (e) { setFormModel(e.target.value); }} placeholder="gpt-4o" />
                  <label>API Key</label>
                  <input value=${formKey} onInput=${function (e) { setFormKey(e.target.value); }} type="password" placeholder="sk-..." />
                  <!-- Headers JSON override section -->
                  <div style="margin-top: 8px; border-top: 1px solid #f0f1f3; padding-top: 8px;">
                    <div style="font-size: 11px; font-weight: 600; color: #667085; cursor: pointer; display: flex; align-items: center; justify-content: space-between;" onClick=${function () { setShowHeadersSection(!showHeadersSection); }}>
                      <span>Headers JSON 覆盖</span>
                      <span style="font-size: 10px; color: #98a2b3;">${showHeadersSection ? '收起 ▲' : '展开 ▼'}</span>
                    </div>
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
                  <!-- Body JSON override section -->
                  <div style="margin-top: 8px; border-top: 1px solid #f0f1f3; padding-top: 8px;">
                    <div style="font-size: 11px; font-weight: 600; color: #667085; cursor: pointer; display: flex; align-items: center; justify-content: space-between;" onClick=${function () { setShowBodySection(!showBodySection); }}>
                      <span>Body JSON 覆盖</span>
                      <span style="font-size: 10px; color: #98a2b3;">${showBodySection ? '收起 ▲' : '展开 ▼'}</span>
                    </div>
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
                  <!-- Request Preview section -->
                  <div style="margin-top: 8px; border-top: 1px solid #f0f1f3; padding-top: 8px;">
                    <div style="font-size: 11px; font-weight: 600; color: #667085; cursor: pointer; display: flex; align-items: center; justify-content: space-between;" onClick=${function () { setShowPreview(!showPreview); }}>
                      <span>📋 请求预览</span>
                      <span style="font-size: 10px; color: #98a2b3;">${showPreview ? '收起 ▲' : '展开 ▼'}</span>
                    </div>
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
                    ` : ''}
                  </div>
                  ${formError ? html`<div class="exmp-config-error">${formError}</div>` : ''}
                  <div class="exmp-config-form-actions exmp-flex exmp-gap-6">
                    <button class="exmp-config-save-btn" disabled=${configSaving} onClick=${saveForm}>${configSaving ? '授权中...' : (editingId ? '更新' : '保存')}</button>
                    <button class="exmp-config-cancel-btn" onClick=${cancelForm}>取消</button>
                  </div>
                </div>
              `}
              <div style="border-top: 1px solid #f0f1f3; margin-top: 10px; padding-top: 10px;">
                <div style="font-size: 12px; font-weight: 600; color: #667085; letter-spacing: 0.3px; margin-bottom: 6px;">📝 提示词设置</div>
                <textarea
                  value=${customPrompt}
                  onInput=${function (e) { setCustomPrompt(e.target.value); }}
                  style="width: 100%; padding: 8px; border: 1px solid #d0d5dd; border-radius: 6px; font-size: 12px; outline: none; resize: vertical; min-height: 100px; box-sizing: border-box; font-family: inherit; line-height: 1.5;"
                  placeholder="输入自定义提示词..."
                ></textarea>
                <div class="exmp-config-form-actions exmp-flex exmp-gap-6" style="margin-top: 6px;">
                  <button class="exmp-config-save-btn" disabled=${promptSaving} onClick=${savePrompt}>${promptSaving ? '保存中...' : '保存提示词'}</button>
                </div>
              </div>
            </div>
          ` : html`
            <div class="exmp-content">
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

          <div class="exmp-footer exmp-flex exmp-items-center exmp-justify-between exmp-p-8-14">
            <span class="exmp-title">⚡ ExamPilot AI</span>
            <div class="exmp-buttons exmp-flex exmp-items-center exmp-gap-6">
              ${viewState === 'config' ? html`
                <button class="exmp-btn exmp-btn-back" onClick=${function () { setViewState('main'); }}>← 返回</button>
              ` : html`
                ${capturing ? html`
                  <button class="exmp-btn exmp-btn-clear" onClick=${cancelCapture}>取消</button>
                ` : html`
                  <button class="exmp-btn exmp-btn-start" onClick=${handleFullscreenCapture}>全屏</button>
                  <button class="exmp-btn exmp-btn-region" onClick=${handleRegionCapture}>区域</button>
                  <button class="exmp-btn exmp-btn-clear" onClick=${handleClear}>清除</button>
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
