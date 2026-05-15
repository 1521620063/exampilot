/**
 * 将截图 dataURL 上传到阿里云 OSS，返回公开访问的图片 URL
 *
 * MV3 的 Service Worker 无法使用依赖 DOM 的 SDK，因此通过 offscreen 文档代理上传。
 * offscreen 文档全局唯一，重复创建时会静默捕获异常复用已有实例。
 *
 * @param {string} dataUrl - 截图产生的 base64 JPEG data URL
 * @returns {Promise<string>} OSS 上的图片公开 URL
 */
async function uploadToOSS(dataUrl) {
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['BLOBS'],
      justification: '通过 OSS SDK 上传截图'
    });
  } catch (e) {
    // offscreen 文档已存在则复用，Chrome 实际报错不是"已存在"而是"只能创建单个"
    // 所以忽略所有创建错误
  }

  // 向 offscreen 文档发送上传请求，委托其执行 OSS client.put()
  const response = await chrome.runtime.sendMessage({
    action: 'uploadToOSS',
    dataUrl,
    ossConfig: OSS_CONFIG
  });

  if (!response.success) {
    throw new Error(response.error || 'OSS上传失败');
  }
  return response.url;
}
