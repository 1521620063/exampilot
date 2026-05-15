/**
 * 配置模板（安全可提交）
 *
 * 使用方式：复制为 config.js 并填入真实密钥。
 * config.js 已被 .gitignore 排除，不会误提交。
 */

// ====== 图片传输方式 ======
// 'oss'   — 截图上传到 OSS 再传 URL 给 AI（需配置下方 OSS_CONFIG）
// 'base64'— 截图以 base64 直传 AI，不经过 OSS
var UPLOAD_MODE = 'base64';

// ====== 阿里云 OSS 配置（仅 UPLOAD_MODE='oss' 时需要）=====
// 截图上传到 OSS 后获得公开 URL，供视觉大模型读取图片
var OSS_CONFIG = {
  region: 'oss-cn-hangzhou',         // OSS 地域节点
  accessKeyId: '你的 AccessKeyId',
  accessKeySecret: '你的 AccessKeySecret',
  bucket: '你的 Bucket 名称'
};

// ====== AI 视觉大模型配置列表（用户可在界面中增删改）=======
// 在此添加默认模板，用户安装后可在界面中增删改。
// 每项格式：{ name: '显示名称', url: 'API 地址', model: '模型名称', apiKey: 'API 密钥',
//            apiMode: '接口模式', selected: true/false }
// apiMode 可选值：'chat-completions'（标准 OpenAI 兼容）, 'responses-api'（OpenAI Responses API）
var API_CONFIG_LIST = [];
