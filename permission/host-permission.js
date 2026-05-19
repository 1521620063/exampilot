(function () {
  var params = new URLSearchParams(window.location.search);
  var origin = params.get('origin') || '';
  var embedded = params.get('embed') === '1';
  var originEl = document.getElementById('origin');
  var statusEl = document.getElementById('status');
  var authorizeBtn = document.getElementById('authorize');

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
        setStatus('你取消了授权。需要授权后才能调用该接口。', 'error');
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
