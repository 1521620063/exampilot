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

  function isValidOrigin(value) {
    return /^https:\/\/[^/]+\/\*$/.test(value);
  }

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
