/**
 * Offscreen 文档：负责执行实际的 OSS 上传操作
 *
 * MV3 的 Service Worker 无法使用依赖 DOM/BOM 的 SDK，
 * 因此将 OSS 上传委托给 offscreen 文档执行。
 * offscreen 文档加载了 aliyun-oss-sdk，这里监听消息完成上传。
 */

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  // 只处理上传请求，忽略其他消息
  if (request.action !== 'uploadToOSS') return;

  (async function () {
    try {
      // 使用 OSS SDK 创建客户端，配置由 background 通过消息传递
      const client = new OSS(request.ossConfig);
      // 将 dataURL 转换为 Blob
      const resp = await fetch(request.dataUrl);
      const blob = await resp.blob();
      // 以时间戳命名文件，按日期文件夹组织
      const fileName = 'screenshot_' + Date.now() + '.jpg';
      const result = await client.put('screenshot/' + fileName, blob);
      // 返回上传成功后的公开 URL
      sendResponse({ success: true, url: result.url });
    } catch (error) {
      sendResponse({ success: false, error: error.message || String(error) });
    }
  })();

  return true; // 异步响应：保持 sendResponse 可用
});
