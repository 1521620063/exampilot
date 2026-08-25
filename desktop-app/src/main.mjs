import { h, render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  applySilentSettings, beginRegionSelection, cancelRequest, captureCurrentMonitor, captureRegion, clearOverlayTargets,
  copyText, exportSettings, finishRegionSelection, getOverlayState, getShortcutErrors, hideAnswerWindow, hideCaptureUi, importSettings, loadSettings, overlayReady,
  loadLastModelResponse, postJson, saveLastModelResponse, saveSettings, setAnswerOpacity, setOverlayTargets, showAnswerWindow, toggleAnswerWindow
} from './desktop-api.mjs';
import { buildRequest, extractAnswer } from './ai-client.mjs';
import { createDefaultSettings, DEFAULT_PROMPT, DEFAULT_SILENT_PROMPT } from './defaults.mjs';
import { buildSilentPrompt, mapTargetsToMonitor, normalizeSilentResult } from './silent.mjs';
import { validateConfigField } from './shared/config-validation.mjs';
import { getDefaultTemplateBodyJson, getDefaultTemplateHeadersJson, getDefaultTemplateResponseText } from './shared/template-engine.mjs';
import * as settingsTransfer from './shared/settings-transfer.mjs';
import { checkForUpdate, currentVersion, downloadAndInstall, formatUpdateError, progressPercent, progressState, updateDetails } from './updater.mjs';
import './styles.css';

var html = htm.bind(h);

globalThis.ExamPilotSettingsTransfer = settingsTransfer;

function activeConfig(settings) {
  return (settings.configList || []).find(function (item) { return item.selected; }) || null;
}

function uiOpacity(value) {
  var opacity = Number(value);
  return Number.isFinite(opacity) ? Math.max(0, Math.min(opacity, 1)) : 0.95;
}

function silentCursorOffset(value) {
  var offset = Number(value);
  return Number.isFinite(offset) ? Math.max(1, Math.min(Math.round(offset), 20)) : 5;
}

function sanitizeAnswer(value) {
  var template = document.createElement('template');
  template.innerHTML = String(value || '');
  var allowed = { B: true, BR: true, STRONG: true, EM: true, I: true, U: true, P: true, DIV: true, SPAN: true, UL: true, OL: true, LI: true, CODE: true, PRE: true };
  function clean(node) {
    Array.prototype.slice.call(node.childNodes).forEach(function (child) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!allowed[child.tagName]) child.replaceWith(document.createTextNode(child.textContent || ''));
        else {
          Array.prototype.slice.call(child.attributes).forEach(function (attr) { child.removeAttribute(attr.name); });
          clean(child);
        }
      } else if (child.nodeType === Node.COMMENT_NODE) child.remove();
    });
  }
  clean(template.content);
  return template.innerHTML;
}

async function publishModelRecord(record) {
  await saveLastModelResponse(record);
  await emit('model-response-updated', record);
}

function nextConfig(settings) {
  var list = settings.configList || [];
  if (!list.length) throw new Error('请先在设置窗口添加 AI 配置');
  var index = list.findIndex(function (item) { return item.selected; });
  if (index < 0) index = 0;
  return Object.assign({}, settings, { configList: list.map(function (item, itemIndex) { return Object.assign({}, item, { selected: itemIndex === (index + 1) % list.length }); }) });
}

function startAnswerDragging(event) {
  if (event.button !== 0) return;
  getCurrentWindow().startDragging().catch(function () {});
}

function AnswerApp() {
  var settingsState = useState(createDefaultSettings()), settings = settingsState[0], setSettings = settingsState[1];
  var statusState = useState('准备就绪'), status = statusState[0], setStatus = statusState[1];
  var answerState = useState(''), answer = answerState[0], setAnswer = answerState[1];
  var busyState = useState(false), busy = busyState[0], setBusy = busyState[1];
  var settingsRef = useRef(settings);
  var settingsVersionRef = useRef(0);
  var busyRef = useRef(busy);
  var operationRef = useRef(0);

  function applySettings(next) {
    settingsVersionRef.current += 1;
    settingsRef.current = next;
    setSettings(next);
    applySilentSettings(next.silentModeEnabled === true, next.silentDebugFrameEnabled === true, next.silentCursorOffset).catch(function (error) {
      setStatus('窗口状态更新失败：' + (error.message || String(error)));
    });
  }

  function updateBusy(next) {
    busyRef.current = next;
    setBusy(next);
  }

  useEffect(function () {
    var initialVersion = settingsVersionRef.current;
    loadSettings().then(function (saved) {
      if (settingsVersionRef.current !== initialVersion) return;
      applySettings(saved);
      setAnswerOpacity(uiOpacity(saved.uiOpacity)).catch(function () {});
    }).catch(function (error) {
      showAnswerWindow().catch(function () {});
      setStatus('设置读取失败：' + (error.message || String(error)));
    });
    getShortcutErrors().then(function (errors) {
      if (errors && errors.length) setStatus('快捷键被占用：' + errors.map(function (item) { return item.split(' ')[0]; }).join('、'));
    }).catch(function () {});
    checkForUpdate().then(function (update) {
      if (update) emit('app-update-available', updateDetails(update)).catch(function () {});
    }).catch(function () {});
    var unlisten = [];
    Promise.all([
      listen('shortcut-capture-full', function () { startFullCapture(); }),
      listen('shortcut-capture-region', function () { startRegionCapture(); }),
      listen('shortcut-switch-config', function () { switchConfig(); }),
      listen('shortcut-clear', function () { clearResults(); }),
      listen('shortcut-toggle-answer', function () {
        if (!settingsRef.current.silentModeEnabled) toggleAnswerWindow().catch(function () {});
      }),
      listen('region-selected', function (event) { processCapture(event.payload.rect); }),
      listen('region-cancelled', function () {
        operationRef.current += 1;
        updateBusy(false);
        setStatus('已取消');
        (settingsRef.current.silentModeEnabled ? hideAnswerWindow() : showAnswerWindow()).catch(function () {});
      }),
      listen('silent-triggered', function () { setStatus('静默模式已触发'); }),
      listen('settings-updated', function (event) {
        applySettings(event.payload);
        setAnswerOpacity(uiOpacity(event.payload.uiOpacity)).catch(function () {});
      })
    ]).then(function (items) { unlisten = items; });
    return function () { unlisten.forEach(function (fn) { fn(); }); };
  }, []);

  function persist(next) {
    applySettings(next);
    return saveSettings(next).then(function () { return emit('settings-updated', next); });
  }

  async function clearResults() {
    operationRef.current += 1;
    await cancelRequest().catch(function () {});
    await finishRegionSelection().catch(function () {});
    await clearOverlayTargets().catch(function () {});
    setAnswer(''); updateBusy(false); setStatus('已清除');
    (settingsRef.current.silentModeEnabled ? hideAnswerWindow() : showAnswerWindow()).catch(function () {});
  }

  async function switchConfig() {
    try {
      var next = nextConfig(settingsRef.current);
      await persist(next);
      setStatus('已切换至 ' + (activeConfig(next).name || '未命名配置'));
    } catch (error) { setStatus(error.message || String(error)); }
  }

  async function startFullCapture() {
    if (busyRef.current) await cancelRequest().catch(function () {});
    var operation = operationRef.current + 1;
    operationRef.current = operation;
    await clearOverlayTargets().catch(function () {});
    setAnswer(''); setStatus('截图中...'); updateBusy(true);
    try {
      await hideCaptureUi();
      await new Promise(function (resolve) { window.setTimeout(resolve, 100); });
      var capture = await captureCurrentMonitor();
      await processCaptureData(capture, operation);
    } catch (error) { finishWithError(error, operation); }
  }

  async function startRegionCapture() {
    if (busyRef.current) await cancelRequest().catch(function () {});
    var operation = operationRef.current + 1;
    operationRef.current = operation;
    await clearOverlayTargets().catch(function () {});
    setAnswer(''); setStatus('请选择截图区域'); updateBusy(true);
    try { await beginRegionSelection(); }
    catch (error) { finishWithError(error, operation); }
  }

  async function processCapture(rect) {
    var operation = operationRef.current;
    try {
      setStatus('截图中...');
      var capture = await captureRegion(rect);
      await finishRegionSelection();
      await processCaptureData(capture, operation);
    } catch (error) {
      await finishRegionSelection().catch(function () {});
      finishWithError(error, operation);
    }
  }

  async function processCaptureData(capture, operation) {
    var requestSettings = settingsRef.current;
    var config = activeConfig(requestSettings);
    if (!config) throw new Error('请先在设置窗口添加并选择 AI 配置');
    setStatus('AI 识别中...');
    var captureWidth = capture.captureRect ? capture.captureRect.width : capture.monitor.width;
    var captureHeight = capture.captureRect ? capture.captureRect.height : capture.monitor.height;
    var requestWasSilent = requestSettings.silentModeEnabled === true;
    var prompt = requestWasSilent ? buildSilentPrompt(requestSettings.silentPrompt || DEFAULT_SILENT_PROMPT, captureWidth, captureHeight) : requestSettings.customPrompt || DEFAULT_PROMPT;
    var request = buildRequest(config, capture.dataUrl, prompt);
    var response = await postJson(request);
    if (operation !== operationRef.current) return;
    var content = extractAnswer(config, response);
    var responseRecord = {
      content: content,
      receivedAt: new Date().toISOString(),
      configName: config.name || '未命名配置',
      apiMode: config.apiMode || 'chat-completions',
      silent: requestWasSilent,
      targetCount: null,
      parseError: ''
    };
    await publishModelRecord(responseRecord);
    var currentSettings = settingsRef.current;
    if (requestWasSilent && currentSettings.silentModeEnabled) {
      var result;
      try {
        result = normalizeSilentResult(content);
        responseRecord.targetCount = result.targets.length;
      } catch (error) {
        responseRecord.parseError = error.message || String(error);
        await publishModelRecord(responseRecord);
        error.exampilotResponseRecorded = true;
        throw error;
      }
      await publishModelRecord(responseRecord);
      if (result.clipboardText) await copyText(result.clipboardText);
      if (result.targets.length) await setOverlayTargets(mapTargetsToMonitor(result.targets, capture), capture.monitor, currentSettings.silentDebugFrameEnabled === true);
      setAnswer('');
      setStatus(result.targets.length ? '静默模式已就绪' : '答案已复制到剪贴板');
    } else {
      await clearOverlayTargets();
      setAnswer(content); setStatus('识别完成');
    }
    updateBusy(false);
    if (!currentSettings.silentModeEnabled) await applySilentSettings(false, false, currentSettings.silentCursorOffset);
  }

  function finishWithError(error, operation) {
    if (operation !== operationRef.current) return;
    updateBusy(false); setAnswer(''); setStatus('错误：' + (error.message || String(error)));
    if (!error.exampilotResponseRecorded) {
      var config = activeConfig(settingsRef.current);
      publishModelRecord({
        content: '',
        receivedAt: new Date().toISOString(),
        configName: config ? config.name || '未命名配置' : '未选择配置',
        apiMode: config ? config.apiMode || 'chat-completions' : '',
        silent: settingsRef.current.silentModeEnabled === true,
        targetCount: null,
        parseError: '',
        requestError: error.message || String(error)
      }).catch(function () {});
    }
    (settingsRef.current.silentModeEnabled ? hideAnswerWindow() : showAnswerWindow()).catch(function () {});
  }

  return html`
    <main class="answer-hud" style=${{ opacity: uiOpacity(settings.uiOpacity) }}>
      <div class="answer-drag-region answer-drag-strip" onMouseDown=${startAnswerDragging}></div>
      ${answer ? html`<article class="answer-content" dangerouslySetInnerHTML=${{ __html: sanitizeAnswer(answer) }}></article>` : null}
    </main>
  `;
}

function OverlayApp() {
  var overlayState = useState({ selecting: false, previewDataUrl: '', start: null, rect: null }), overlay = overlayState[0], setOverlay = overlayState[1];
  useEffect(function () {
    var unlisten = [];
    getOverlayState().then(function (saved) {
      setOverlay({ selecting: saved.selecting === true, previewDataUrl: saved.previewDataUrl || '', start: null, rect: null });
      if (saved.selecting === true) return overlayReady();
    }).catch(function () {});
    Promise.all([
      listen('region-selection', function () {
        getOverlayState().then(function (saved) {
          setOverlay({ selecting: true, previewDataUrl: saved.previewDataUrl || '', start: null, rect: null });
          return overlayReady();
        }).catch(function () {});
      })
    ]).then(function (items) { unlisten = items; });
    function onKeyDown(event) {
      if (event.key !== 'Escape') return;
      finishRegionSelection().then(function () { return emit('region-cancelled'); }).catch(function () {});
      setOverlay({ selecting: false, previewDataUrl: '', start: null, rect: null });
    }
    window.addEventListener('keydown', onKeyDown);
    unlisten.push(function () { window.removeEventListener('keydown', onKeyDown); });
    return function () { unlisten.forEach(function (fn) { fn(); }); };
  }, []);
  function point(event) { return { x: event.clientX, y: event.clientY }; }
  function down(event) { if (overlay.selecting) { var start = point(event); setOverlay(Object.assign({}, overlay, { start: start, rect: { x: start.x, y: start.y, width: 0, height: 0 } })); } }
  function move(event) {
    if (!overlay.selecting || !overlay.start) return;
    var current = point(event); var x = Math.min(overlay.start.x, current.x); var y = Math.min(overlay.start.y, current.y);
    setOverlay(Object.assign({}, overlay, { rect: { x: x, y: y, width: Math.abs(current.x - overlay.start.x), height: Math.abs(current.y - overlay.start.y) } }));
  }
  async function up() {
    if (!overlay.selecting || !overlay.rect) return;
    if (overlay.rect.width < 5 || overlay.rect.height < 5) {
      setOverlay(Object.assign({}, overlay, { start: null, rect: null }));
      return;
    }
    await emit('region-selected', { rect: overlay.rect });
    setOverlay(Object.assign({}, overlay, { selecting: false, start: null, rect: null }));
  }
  return html`<main class=${overlay.selecting ? 'screen-overlay selecting' : 'screen-overlay'} style=${overlay.previewDataUrl ? { backgroundImage: 'url("' + overlay.previewDataUrl + '")' } : null} onMouseDown=${down} onMouseMove=${move} onMouseUp=${up}>
    ${overlay.selecting && overlay.rect ? html`<div class="selection-box" style=${{ left: overlay.rect.x + 'px', top: overlay.rect.y + 'px', width: overlay.rect.width + 'px', height: overlay.rect.height + 'px' }}></div>` : null}
  </main>`;
}

function DebugApp() {
  return html`<main class="debug-window"><span class="debug-window-center" aria-hidden="true"></span></main>`;
}

function ConfigEditor(props) {
  var config = props.config;
  var update = props.update;
  var updateMany = props.updateMany;
  var previewState = useState(false), showPreview = previewState[0], setShowPreview = previewState[1];
  var touchedState = useState({}), touched = touchedState[0], setTouched = touchedState[1];
  function touch(field) { setTouched(function (current) { return Object.assign({}, current, { [field]: true }); }); }
  function input(field, event) { touch(field); update(field, event.currentTarget.value); }
  function errorFor(field) { return touched[field] ? validateConfigField(config, field) : ''; }
  function fieldClass(field) { return errorFor(field) ? 'form-field has-error' : 'form-field'; }
  var preview;
  var previewError = '';
  if (showPreview) {
    try {
      var request = buildRequest(config, 'data:image/jpeg;base64,<image-base64>', props.previewPrompt || DEFAULT_PROMPT);
      var serialized = JSON.stringify(request, null, 2);
      preview = config.apiKey ? serialized.split(config.apiKey).join('***') : serialized;
    } catch (error) { previewError = error.message || String(error); }
  }
  return html`<div class="config-form">
    <label class=${fieldClass('name')}>名称<input value=${config.name || ''} placeholder="例如：阿里云百炼" required aria-invalid=${Boolean(errorFor('name'))} onInput=${function (e) { input('name', e); }} onBlur=${function () { touch('name'); }} />${errorFor('name') ? html`<span class="field-error">${errorFor('name')}</span>` : null}</label>
    <label class=${fieldClass('url')}>接口地址<input type="url" value=${config.url || ''} placeholder="https://api.example.com/v1/chat/completions" required aria-invalid=${Boolean(errorFor('url'))} onInput=${function (e) { input('url', e); }} onBlur=${function () { touch('url'); }} />${errorFor('url') ? html`<span class="field-error">${errorFor('url')}</span>` : null}</label>
    <label class=${fieldClass('model')}>模型<input value=${config.model || ''} placeholder="例如：qwen3.7-plus" required=${config.apiMode !== 'custom-template'} aria-invalid=${Boolean(errorFor('model'))} onInput=${function (e) { input('model', e); }} onBlur=${function () { touch('model'); }} />${errorFor('model') ? html`<span class="field-error">${errorFor('model')}</span>` : null}</label>
    <label class="form-field">API Key<input type="password" value=${config.apiKey || ''} placeholder="请输入服务商 API Key" autocomplete="off" onInput=${function (e) { update('apiKey', e.currentTarget.value); }} /></label>
    <label>接口模式<select value=${config.apiMode || 'chat-completions'} onChange=${function (e) { update('apiMode', e.currentTarget.value); }}><option value="chat-completions">Chat Completions</option><option value="responses-api">Responses API</option><option value="anthropic">Anthropic Messages</option><option value="custom-template">自定义模板</option></select></label>
    <label class=${fieldClass('customHeadersJson')}>Headers JSON<textarea value=${config.customHeadersJson || ''} placeholder=${'{"X-API-Key":"your-api-key"}'} aria-invalid=${Boolean(errorFor('customHeadersJson'))} onInput=${function (e) { input('customHeadersJson', e); }} onBlur=${function () { touch('customHeadersJson'); }} />${errorFor('customHeadersJson') ? html`<span class="field-error">${errorFor('customHeadersJson')}</span>` : null}</label>
    <label class=${fieldClass('customBodyJson')}>Body JSON<textarea value=${config.customBodyJson || ''} placeholder=${'{"temperature":0.2}'} aria-invalid=${Boolean(errorFor('customBodyJson'))} onInput=${function (e) { input('customBodyJson', e); }} onBlur=${function () { touch('customBodyJson'); }} />${errorFor('customBodyJson') ? html`<span class="field-error">${errorFor('customBodyJson')}</span>` : null}</label>
    ${config.apiMode === 'custom-template' ? html`<div class="form-section-head"><strong>自定义模板</strong><button type="button" onClick=${function () { updateMany({ templateHeadersJson: getDefaultTemplateHeadersJson(), templateBodyJson: getDefaultTemplateBodyJson(), templateResponseText: getDefaultTemplateResponseText() }); }}>恢复模板默认值</button></div><label>Headers 模板<textarea value=${config.templateHeadersJson || ''} placeholder=${getDefaultTemplateHeadersJson()} onInput=${function (e) { update('templateHeadersJson', e.currentTarget.value); }} /></label><label>Body 模板<textarea value=${config.templateBodyJson || ''} placeholder=${getDefaultTemplateBodyJson()} onInput=${function (e) { update('templateBodyJson', e.currentTarget.value); }} /></label><label>响应模板<textarea value=${config.templateResponseText || ''} placeholder=${getDefaultTemplateResponseText()} onInput=${function (e) { update('templateResponseText', e.currentTarget.value); }} /></label>` : null}
    <div class="request-preview"><button type="button" onClick=${function () { setShowPreview(!showPreview); }}>${showPreview ? '收起请求预览' : '展开请求预览'}</button>${showPreview ? previewError ? html`<p class="response-error">${previewError}</p>` : html`<pre>${preview}</pre>` : null}</div>
  </div>`;
}

function SettingsApp() {
  var state = useState(createDefaultSettings()), settings = state[0], setSettings = state[1];
  var messageState = useState(''), message = messageState[0], setMessage = messageState[1];
  var responseState = useState(null), lastResponse = responseState[0], setLastResponse = responseState[1];
  var versionState = useState('读取中…'), version = versionState[0], setVersion = versionState[1];
  var updateState = useState(null), update = updateState[0], setUpdate = updateState[1];
  var updateBusyState = useState(false), updateBusy = updateBusyState[0], setUpdateBusy = updateBusyState[1];
  var updateProgressState = useState(null), updateProgress = updateProgressState[0], setUpdateProgress = updateProgressState[1];
  var updateRef = useRef(null);
  var settingsRef = useRef(settings);
  function updateLocalSettings(next) {
    settingsRef.current = next;
    setSettings(next);
  }
  useEffect(function () {
    var unlisten = null;
    loadSettings().then(function (saved) {
      updateLocalSettings(saved);
      return applySilentSettings(saved.silentModeEnabled === true, saved.silentDebugFrameEnabled === true, saved.silentCursorOffset);
    }).catch(function (error) { setMessage(error.message || String(error)); });
    loadLastModelResponse().then(setLastResponse).catch(function () {});
    currentVersion().then(setVersion).catch(function () { setVersion('未知'); });
    checkForUpdate().then(function (available) {
      if (available) { updateRef.current = available; setUpdate(updateDetails(available)); }
    }).catch(function () {});
    listen('settings-updated', function (event) { updateLocalSettings(event.payload); }).then(function (fn) { unlisten = fn; }).catch(function () {});
    var unlistenUpdate = null;
    listen('app-update-available', function (event) {
      setUpdate(event.payload);
      setMessage('发现新版本 ' + event.payload.version + '，请在下方确认更新。');
      checkForUpdate().then(function (available) {
        if (available) { updateRef.current = available; setUpdate(updateDetails(available)); }
      }).catch(function () {});
    }).then(function (fn) { unlistenUpdate = fn; }).catch(function () {});
    var unlistenResponse = null;
    listen('model-response-updated', function (event) { setLastResponse(event.payload); }).then(function (fn) { unlistenResponse = fn; }).catch(function () {});
    return function () { if (unlisten) unlisten(); if (unlistenResponse) unlistenResponse(); if (unlistenUpdate) unlistenUpdate(); };
  }, []);
  var config = activeConfig(settings);
  async function persist(next) {
    updateLocalSettings(next);
    await saveSettings(next);
    await setAnswerOpacity(uiOpacity(next.uiOpacity)).catch(function () {});
    await emit('settings-updated', next);
  }
  async function patchSettings(field, value) {
    if (field === 'silentCursorOffset') value = silentCursorOffset(value);
    var next = Object.assign({}, settingsRef.current, { [field]: value });
    try {
      updateLocalSettings(next);
      var runtime = null;
      if (field === 'silentModeEnabled' || field === 'silentDebugFrameEnabled' || field === 'silentCursorOffset') {
        runtime = await applySilentSettings(next.silentModeEnabled === true, next.silentDebugFrameEnabled === true, next.silentCursorOffset);
      }
      await saveSettings(next);
      await setAnswerOpacity(uiOpacity(next.uiOpacity)).catch(function () {});
      await emit('settings-updated', next);
      if (runtime) {
        if (next.silentModeEnabled && next.silentDebugFrameEnabled && runtime.targetCount === 0) {
          setMessage('静默命中框已开启；请先执行一次静默识别，识别到选项坐标后才会显示命中框。');
        } else {
          setMessage('设置已生效');
        }
      }
    } catch (error) { showError(error); }
  }
  function showError(error) { setMessage(error.message || String(error)); }
  function selectConfig(id) { persist(Object.assign({}, settings, { configList: settings.configList.map(function (item) { return Object.assign({}, item, { selected: item.id === id }); }) })).catch(showError); }
  function addConfig() {
    var id = 'cfg_' + Date.now();
    var next = Object.assign({}, settings, { configList: settings.configList.map(function (item) { return Object.assign({}, item, { selected: false }); }).concat([{ id: id, name: '新配置', url: '', model: '', apiKey: '', apiMode: 'chat-completions', customHeadersJson: '', customBodyJson: '', templateHeadersJson: '', templateBodyJson: '', templateResponseText: '', selected: true }]) });
    persist(next).catch(showError);
  }
  function deleteConfig(id) {
    if (!window.confirm('确定删除这个 AI 配置吗？')) return;
    var remaining = settings.configList.filter(function (item) { return item.id !== id; });
    if (remaining.length && !remaining.some(function (item) { return item.selected; })) remaining[0].selected = true;
    persist(Object.assign({}, settings, { configList: remaining })).catch(showError);
  }
  function updateConfig(field, value) {
    persist(Object.assign({}, settings, { configList: settings.configList.map(function (item) { return item.id === config.id ? Object.assign({}, item, { [field]: value }) : item; }) })).catch(showError);
  }
  function updateConfigFields(fields) {
    persist(Object.assign({}, settingsRef.current, { configList: settingsRef.current.configList.map(function (item) { return item.id === config.id ? Object.assign({}, item, fields) : item; }) })).catch(showError);
  }
  async function doImport() {
    try {
      if (!window.confirm('导入会替换当前桌面端的全部 ExamPilot 配置，是否继续？')) return;
      var backup = await importSettings(); if (!backup) return;
      var normalized = globalThis.ExamPilotSettingsTransfer.normalizeSettingsBackup(backup);
      await persist(normalized);
      await applySilentSettings(normalized.silentModeEnabled === true, normalized.silentDebugFrameEnabled === true, normalized.silentCursorOffset);
      setMessage('设置已导入');
    } catch (error) { showError(error); }
  }
  async function doExport() {
    try {
      var backup = globalThis.ExamPilotSettingsTransfer.createSettingsBackup(settings);
      if (await exportSettings(backup)) setMessage('设置已导出');
    } catch (error) { showError(error); }
  }
  async function copyLastResponse() {
    if (!lastResponse) return;
    var output = [];
    if (lastResponse.requestError) output.push('运行错误：' + lastResponse.requestError);
    if (lastResponse.parseError) output.push('解析错误：' + lastResponse.parseError);
    if (lastResponse.content) output.push(lastResponse.content);
    try { await copyText(output.join('\n\n')); setMessage('模型返回和错误信息已复制'); }
    catch (error) { showError(error); }
  }
  async function clearLastResponse() {
    try { await saveLastModelResponse(null); setLastResponse(null); setMessage('模型原始返回已清空'); }
    catch (error) { showError(error); }
  }
  async function checkForUpdates() {
    try {
      setMessage('正在检查更新…');
      var available = await checkForUpdate();
      if (!available) { setUpdate(null); updateRef.current = null; setMessage('当前已是最新版本'); return; }
      updateRef.current = available;
      setUpdate(updateDetails(available));
      setMessage('发现新版本 ' + available.version);
    } catch (error) { setMessage(formatUpdateError(error)); }
  }
  async function installUpdate() {
    var available = updateRef.current;
    if (!available || updateBusy) return;
    if (!window.confirm('将下载并安装 ExamPilot ' + available.version + '，完成后应用会重启。是否继续？')) return;
    try {
      setUpdateBusy(true); setUpdateProgress({ downloaded: 0, total: null, finished: false }); setMessage('正在下载更新…');
      await downloadAndInstall(available, function (event) {
        setUpdateProgress(function (state) { return progressState(event, state); });
      });
    } catch (error) {
      setUpdateBusy(false); setMessage(formatUpdateError(error));
    }
  }
  return html`<main class="settings-page">
    <header><div><h1>ExamPilot 设置</h1><p>答案窗口默认显示在屏幕右下角，可拖动调整位置。</p></div><div class="settings-actions"><button onClick=${addConfig}>添加配置</button><button onClick=${doImport}>导入</button><button onClick=${doExport}>导出</button></div></header>
    <p class="settings-security-note">导入和导出文件包含 API Key，请勿分享或上传到公共位置。</p>
    ${message ? html`<p class="settings-message">${message}</p>` : null}
    <section class="settings-grid"><aside><h2>AI 配置</h2>${settings.configList.map(function (item) { return html`<div class=${item.selected ? 'config-item active' : 'config-item'} onClick=${function () { selectConfig(item.id); }}><span>${item.name || '未命名配置'}</span><button class="config-delete" title="删除" onClick=${function (event) { event.stopPropagation(); deleteConfig(item.id); }}>删除</button></div>`; })}</aside><div>${config ? html`<${ConfigEditor} key=${config.id} config=${config} update=${updateConfig} updateMany=${updateConfigFields} previewPrompt=${settings.silentModeEnabled ? settings.silentPrompt : settings.customPrompt} />` : html`<p class="empty-config">添加一个 AI 配置后即可开始使用。</p>`}</div></section>
    <section class="preferences"><h2>识别与界面</h2><label class="toggle"><input type="checkbox" checked=${settings.silentModeEnabled === true} onChange=${function (e) { patchSettings('silentModeEnabled', e.currentTarget.checked); }} />静默模式</label><label class="toggle"><input type="checkbox" checked=${settings.silentDebugFrameEnabled === true} onChange=${function (e) { patchSettings('silentDebugFrameEnabled', e.currentTarget.checked); }} />显示静默命中框</label><label>${'\u771F\u5B9E\u5149\u6807\u89E6\u53D1\u53F3\u79FB'}<input type="number" min="1" max="20" step="1" value=${settings.silentCursorOffset} onChange=${function (e) { patchSettings('silentCursorOffset', Number(e.currentTarget.value)); }} /></label><label>答案窗口透明度 ${Math.round(uiOpacity(settings.uiOpacity) * 100)}%<input type="range" min="0" max="100" step="1" value=${Math.round(uiOpacity(settings.uiOpacity) * 100)} onInput=${function (e) { patchSettings('uiOpacity', Number(e.currentTarget.value) / 100); }} /></label><div class="prompt-head"><strong>普通提示词</strong><button type="button" onClick=${function () { patchSettings('customPrompt', DEFAULT_PROMPT); }}>恢复默认</button></div><textarea value=${settings.customPrompt || ''} onInput=${function (e) { patchSettings('customPrompt', e.currentTarget.value); }} /><div class="prompt-head"><strong>静默提示词</strong><button type="button" onClick=${function () { patchSettings('silentPrompt', DEFAULT_SILENT_PROMPT); }}>恢复默认</button></div><textarea value=${settings.silentPrompt || ''} onInput=${function (e) { patchSettings('silentPrompt', e.currentTarget.value); }} /></section>
    <section class="preferences app-update"><div class="model-response-head"><div><h2>应用更新</h2><p>当前版本：${version}</p></div><button type="button" disabled=${updateBusy} onClick=${checkForUpdates}>检查更新</button></div>${update ? html`<div class="update-details"><p>发现新版本：${update.version}${update.date ? ' · ' + new Date(update.date).toLocaleDateString() : ''}</p>${update.body ? html`<pre>${update.body}</pre>` : null}<button type="button" disabled=${updateBusy} onClick=${installUpdate}>${updateBusy ? updateProgress && progressPercent(updateProgress) !== null ? '下载中 ' + progressPercent(updateProgress) + '%' : '下载中…' : '下载并重启更新'}</button></div>` : html`<p>点击“检查更新”获取最新稳定版。</p>`}</section>
    <section class="model-response"><div class="model-response-head"><div><h2>最近一次模型返回 / 错误</h2>${lastResponse ? html`<p>${new Date(lastResponse.receivedAt).toLocaleString()} · ${lastResponse.configName} · ${lastResponse.silent ? '静默模式' : '普通模式'}${lastResponse.targetCount !== null ? ' · 命中框 ' + lastResponse.targetCount + ' 个' : ''}</p>` : null}</div><div class="settings-actions"><button disabled=${!lastResponse} onClick=${copyLastResponse}>复制</button><button disabled=${!lastResponse} onClick=${clearLastResponse}>清空</button></div></div>${lastResponse && lastResponse.requestError ? html`<p class="response-error">运行错误：${lastResponse.requestError}</p>` : null}${lastResponse && lastResponse.parseError ? html`<p class="response-error">解析错误：${lastResponse.parseError}</p>` : null}<textarea readonly value=${lastResponse ? lastResponse.content || '本次请求没有收到模型正文' : '尚未收到模型返回或错误'}></textarea></section>
  </main>`;
}

var windowKind = new URLSearchParams(window.location.search).get('window');
render(windowKind === 'overlay' ? html`<${OverlayApp} />` : windowKind === 'debug' ? html`<${DebugApp} />` : windowKind === 'settings' ? html`<${SettingsApp} />` : html`<${AnswerApp} />`, document.getElementById('app'));
