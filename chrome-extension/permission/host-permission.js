/**
 * 可选权限申请页脚本（host-permission.html 内嵌）：
 * 展示待授权的 origin，点击按钮调用 chrome.permissions.request 申请主机权限。
 * 支持两种用途：'api'（授权 AI 接口域名）与 'frame'（授权跨域 iframe 域名，
 * 供静默模式仿光标进入）；以 iframe 嵌入（embed=1）时会通过 postMessage
 * 把授权结果回传给父页面。
 */
(function () {
  var params = new URLSearchParams(window.location.search);
  var origin = params.get('origin') || '';
  var embedded = params.get('embed') === '1';
  var purpose = params.get('purpose') || 'api';
  var originEl = document.getElementById('origin');
  var statusEl = document.getElementById('status');
  var authorizeBtn = document.getElementById('authorize');
  var titleEl = document.getElementById('permission-title');
  var descriptionEl = document.getElementById('permission-description');

  if (embedded) {
    document.body.className = 'embedded';
  }

  if (purpose === 'frame') {
    titleEl.textContent = '授权 iframe 域名';
    descriptionEl.textContent = 'ExamPilot 需要访问下面这个 iframe 域名，才能在静默模式下隐藏原生光标并持续跟踪仿光标。';
  }

  function setStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = type || '';
  }

  // 仅接受 https://域名/* 形式的匹配模式，防止任意模式被申请
  function isValidOrigin(value) {
    return /^https:\/\/[^/]+\/\*$/.test(value);
  }

  // iframe 嵌入模式下，把授权结果回传给父页面（面板中的授权弹窗）
  function notifyParent(granted) {
    if (!embedded) return;
    window.parent.postMessage({
      source: 'exampilot-permission',
      granted: granted,
      origin: origin
    }, '*');
  }

  originEl.textContent = origin || '缺少授权域名';

  if (!isValidOrigin(origin)) {
    authorizeBtn.disabled = true;
    setStatus('授权地址无效，请回到配置页检查 API URL。', 'error');
    return;
  }

  // 点击“授权”：申请主机权限，成功后延时回传结果并关闭页面
  authorizeBtn.addEventListener('click', function () {
    authorizeBtn.disabled = true;
    setStatus('正在请求浏览器授权...');

    chrome.permissions.request({ origins: [origin] }, function (granted) {
      if (chrome.runtime.lastError) {
        authorizeBtn.disabled = false;
        setStatus(chrome.runtime.lastError.message || '授权请求失败', 'error');
        return;
      }

      if (!granted) {
        authorizeBtn.disabled = false;
        setStatus(purpose === 'frame' ? '你取消了授权，仿光标无法进入该 iframe。' : '你取消了授权。需要授权后才能调用该接口。', 'error');
        notifyParent(false);
        return;
      }

      setStatus(embedded ? '授权成功，正在返回。' : '授权成功。请回到 ExamPilot 配置页再次点击保存。', 'success');
      window.setTimeout(function () {
        notifyParent(true);
        if (!embedded) {
          window.close();
        }
      }, 1200);
    });
  });
})();
