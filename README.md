# 🚀 ExamPilot — 智能解题引擎

**基于视觉 AI 的实时答题系统**：一键截图，精准识别网页题目，调用大模型实时推理，秒级获取答案与解析。 🧠✨

---

## 📖 概述

ExamPilot 是一款 Chrome 浏览器扩展，能够在任意网页中**即时截取当前视口**，借助视觉大模型自动识别题目并生成高精度答案。无需手动输入，无需切换页面，让知识获取零摩擦。

## 🔄 工作流程

```
用户触发识别
      │
      ▼
  截图 ──▶ 视觉 AI 推理
      │
      ▼
  浮动面板呈现 AI 解析结果
```

### 🔗 核心链路

| 阶段 | 技术实现 | 说明 |
|------|---------|------|
| **📸 截图** | `chrome.tabs.captureVisibleTab` → 可选 `cropImage()` | 捕获当前浏览器视口，支持全屏截图或拖拽选择指定区域（物理像素坐标 × devicePixelRatio） |
| **🔐 授权** | `optional_host_permissions` + 当前页授权弹层 | 首次使用某个 API 域名时按需授权，避免安装时申请 `<all_urls>` |
| **🧠 推理** | 视觉大模型（OpenAI 兼容 / Anthropic 直接 API） | 理解题目内容并推理作答（模型可配置） |
| **🖥️ 展示** | 浮动交互面板 | 页面右下角实时展示识别进度与结果 |

## 🚀 快速开始

### 📦 安装

```bash
# 1. 克隆项目
git clone <repo-url>
cd exampilot-extension

# 2. 安装依赖并构建
npm install
npm run build

# 3. 加载到 Chrome
#    打开 chrome://extensions → 开启开发者模式 → 加载已解压的扩展 → 选择 dist/chrome 目录
```

> 构建产物输出至 `dist/chrome/`。
> - `npm run build` — 压缩构建，适合本地开发加载
> - `npm run build:package` — 不压缩构建，适合上架前检查与打包
> - 当前版本使用 `optional_host_permissions` 动态授权 API 域名，不再写死 `host_permissions: ["<all_urls>"]`

### 🎮 使用方式

| 操作 | 说明 |
|------|------|
| 🖱️ 点击扩展工具栏图标 | 呼出浮动面板 |
| 👆 双击页面空白区域 | 切换面板显示 / 隐藏 |
| 🎯 点击 **全屏** | 截图整个视口 → AI 推理全流程 |
| 🖱️ 点击 **区域** | 进入拖拽选择模式，只识别选中的页面区域 |
| ⏹️ 识别中点击 **取消** | 取消上一次进行中的 AI 请求（接口卡住时可中止） |
| ⌨️ 区域选择时按 **ESC** | 取消区域选择，恢复面板 |
| 🗑️ 点击 **清除** | 清空当前识别结果 |
| ⚙️ 点击 **⚙️ 设置** | 管理 AI 配置：添加/编辑/删除/切换视觉大模型 |
| ✏️ 在 ⚙️ 中编辑提示词 | 自定义发送给 AI 的指令，支持多行文本，自动保存 |
| 🔧 在 ⚙️ 中配置自定义请求头/请求体 | 为每个 AI 配置添加任意的 HTTP 请求头和请求体字段，满足不同 API 的个性化需求 |
| 👁️ 在 ⚙️ 中展开请求预览 | 在发送前预览实际 API 请求的完整 JSON 结构，便于调试 |
| 🔐 首次使用某个 API 域名 | 当前页面会弹出授权框，点击授权后即可调用该厂商接口 |
| ◀️ 按 **← 返回** | 从配置管理返回主面板 |

识别过程中，状态栏会依次显示 `截图 → AI 识别中 → 完成`，进度透明可追溯。

## 📁 项目结构

```
exampilot-extension/
├── manifest.json            # Manifest V3 扩展清单
├── package.json             # 构建脚本与依赖
├── scripts/
│   └── build.mjs            # esbuild 打包脚本
├── background/
│   ├── index.js             # SW 入口：消息路由与流程编排
│   └── query-ai.js          # AI API 调用模块
├── content/
│   ├── index.js             # 内容脚本入口（esbuild 构建入口）
│   ├── ui.js                # Preact+htm 浮动面板组件（Shadow DOM）
│   └── bundle/
│       └── content-bundle.js # 构建产物（IIFE）
├── permission/
│   ├── host-permission.html # 当前页 iframe 授权页
│   └── host-permission.js   # 点击按钮申请 optional host permission
├── icons/                   # 扩展图标（16/48/128）
├── docs/                    # 营销落地页与隐私政策
├── dist/chrome/             # 构建输出目录（已 gitignore，加载扩展时选择此目录）
│   ├── background/index.js
│   ├── content/bundle/content-bundle.js
│   ├── permission/
│   ├── manifest.json
│   └── icons/
├── .claude/                 # Claude Code 配置与记忆
├── AGENTS.md                # Codex 指令（与 CLAUDE.md 同步）
├── CLAUDE.md
├── README.md
└── LICENSE
```

## ⚙️ 配置说明

AI 配置通过面板右下角的 **⚙️ 设置** 按钮管理，支持添加多个视觉大模型配置并随时切换。每项包含 `name`、`url`、`model`、`apiKey`、`apiMode`。接口地址必须使用 HTTPS。支持三种接口模式：

- **Chat Completions** — 标准 OpenAI 兼容接口 (`/v1/chat/completions`)
- **Responses API** — OpenAI Responses API (`/v1/responses`)
- **Anthropic Claude** — Anthropic 直接 API (`/v1/messages`)

新增配置自动设为当前使用（`selected: true`）。

### 🔐 API 域名授权

为了更容易通过 Chrome 应用商店审核，扩展不会在安装时申请 `host_permissions: ["<all_urls>"]`。当前采用按需授权方案：

- `manifest.json` 声明 `optional_host_permissions: ["https://*/*"]`
- 添加配置或点击识别时，扩展会检查当前 API URL 对应的域名权限，例如 `https://ark.cn-beijing.volces.com/*`
- 如果尚未授权，当前网页会出现一个 ExamPilot 授权弹层，不会新开标签页
- 在弹层中点击“授权访问该域名”后，扩展后台即可直接调用该接口，避免部分厂商接口因 CORS 被浏览器拦截
- 如果用户取消授权，配置仍不会绕过权限限制，识别前会继续提示需要授权

> 注意：`chrome.permissions.request()` 必须由用户点击触发，所以授权按钮位于扩展自己的 iframe 页面中。不要把授权申请放到后台异步请求或截图流程里。

### 🔧 自定义请求头与请求体

每个 AI 配置支持添加**自定义 HTTP 请求头（Headers）** 和 **自定义请求体字段（Body Fields）**，满足不同 API 的特殊需求：

- **请求头示例**：设置 `anthropic-version: 2023-06-01` 等供应商特定参数
- **请求体示例**：添加 `max_tokens: 4096`、`temperature: 0.7` 等推理参数
- 数值型字段值自动转换为数字类型发送
- 切换 API 模式时，Anthropic 模式自动填充 `anthropic-version` 请求头和 `max_tokens` 请求体字段
- 配置列表项会显示自定义字段数量，一目了然

### 👁️ 请求预览

在发送截图请求前，可展开 **请求预览** 面板查看即将发出的完整 API 请求结构（含合并后的请求头、请求体和图片数据），方便调试和确认配置正确性。

### ✏️ 自定义提示词

在 ⚙️ 设置页面底部可编辑**发送给 AI 的提示词**，支持自由修改指令格式。提示词独立存储（不与 AI 配置绑定），修改后全局生效。

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 🧩 扩展框架 | Chrome Extension Manifest V3 |
| 🎨 UI 框架 | Preact + htm（VDOM 渲染，Shadow DOM 样式隔离） |
| 🔨 构建工具 | esbuild（ESM → IIFE 打包） |
| 📡 图像传输 | base64 直传 AI |
| 🧠 视觉推理 | 视觉大模型（OpenAI 兼容 / Anthropic 直接 API，模型可配置） |
| ⚡ 扩展能力 | Service Worker · Content Script · Optional Host Permissions |

## 🤖 关于 AI

本项目由 **Claude（Anthropic）** 从第一行代码开始生成。

> 别问为什么代码写得这么好 —— 问就是 Claude 写的，改 bug 也得找 Claude，别来问我，我只会按截图发需求和提出问题。

## 📄 许可证

[MIT](LICENSE)
