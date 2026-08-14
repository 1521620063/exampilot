# 🚀 ExamPilot — 智能解题引擎

**基于视觉 AI 的实时答题系统**：一键全屏或框选截图，精准识别网页题目，调用大模型实时推理，秒级获取答案与解析。 🧠✨

---

## 📖 概述

ExamPilot 是一款 Chrome 浏览器扩展，能够在任意网页中**即时截取当前视口或选中区域**，借助视觉大模型自动识别题目并生成高精度答案。无需手动输入，无需切换页面，让知识获取零摩擦。

## 🔄 工作流程

```
用户触发识别
      │
      ▼
  截图/裁剪 ──▶ 视觉 AI 推理
      │
      ▼
  浮动面板呈现 AI 解析结果
```

### 🔗 核心链路

| 阶段 | 技术实现 | 说明 |
|------|---------|------|
| **📸 截图** | `chrome.tabs.captureVisibleTab` → 可选 `cropImage()` | 捕获当前浏览器视口，支持全屏截图或拖拽选择指定区域（物理像素坐标 × devicePixelRatio） |
| **🔐 授权** | 双构建权限策略 | 普通版按需授权 API 域名；Full Access 版安装/更新时获得完整网站访问能力 |
| **🧠 推理** | 视觉大模型（OpenAI 兼容 / Responses API / Anthropic / 自定义模板） | 理解题目内容并推理作答（请求格式可配置） |
| **🖥️ 展示** | 浮动交互面板 | 页面右下角实时展示识别进度与结果，支持透明度调节 |

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

> 构建产物输出至 `dist/`。
> - `npm run build` — 构建普通版到 `dist/chrome/`：点击图标后注入隐藏面板，API 域名按需授权
> - `npm run build:package` — 构建普通版未压缩包到 `dist/chrome/`，适合上架前检查与打包
> - `npm run build:full` — 构建 Full Access 版到 `dist/chrome-full/`：任意网页自动加载隐藏面板，不再弹 API 域名单独授权
> - `npm run build:full:package` — 构建 Full Access 未压缩包到 `dist/chrome-full/`，适合本地审查
> - `npm test` — 使用 Node 内置 `node --test` 运行测试；当前工作区若无测试文件会显示 0 tests

### 🎮 使用方式

| 操作 | 说明 |
|------|------|
| 🖱️ 普通版点击扩展工具栏图标 | 注入隐藏面板，不直接显示 |
| 🖱️ Full Access 版点击扩展工具栏图标 | 切换浮动面板显示 / 隐藏 |
| 👆 双击页面空白区域 | 切换面板显示 / 隐藏 |
| 🎯 点击 **全屏** | 截图整个视口 → AI 推理全流程 |
| 🖱️ 点击 **区域** | 进入拖拽选择模式，只识别选中的页面区域 |
| ⏹️ 点击 **取消/清除** | 识别中取消请求；已有结果时清空答案、静默命中区与调试框 |
| ⌨️ 区域选择时按 **ESC** | 取消区域选择，恢复面板 |
| ⚙️ 点击 **⚙️ 设置** | 管理 AI 配置：添加/编辑/删除/切换视觉大模型 |
| ➖ 点击 **—** | 折叠为迷你 ⚡ 按钮；拖动按钮可调整面板位置，点击可重新展开 |
| ✏️ 在 ⚙️ 中编辑提示词 | 自定义发送给 AI 的指令，支持多行文本，自动保存 |
| 🕶️ 在 ⚙️ 中开启静默模式 | AI 返回答案与百分比坐标，页面创建透明命中区，鼠标悬停后以仿光标轻微位移反馈；跨域 iframe 首次使用时会请求该 iframe 域名授权 |
| 📋 静默模式遇到简答/编程题 | 无可悬浮选项时自动把 AI 返回答案复制到剪切板 |
| 🎯 在 ⚙️ 中开启显示静默框 | 调试时用红色框显示 AI 返回的百分比命中区；关闭后仅保留悬浮触发 |
| 🔧 在 ⚙️ 中配置请求覆盖/模板 | 为每个 AI 配置添加 HTTP 请求头、请求体字段，或完整自定义模板，满足不同 API 的个性化需求 |
| 👁️ 在 ⚙️ 中展开请求预览 | 在发送前预览实际 API 请求的完整 JSON 结构，便于调试 |
| 💾 在 ⚙️ → 配置迁移中导入/导出 | 将全部模型配置、提示词、静默模式设置和透明度备份为 JSON，或在其他设备恢复 |
| 🎛️ 在 ⚙️ 中调整界面透明度 | 降低悬浮面板遮挡，偏好保存到本地浏览器 |
| ◀️ 按 **← 返回** | 从配置管理返回主面板 |

### ⌨️ 快捷键

| 快捷键 | 说明 |
|--------|------|
| `Ctrl+Shift+1` / macOS `MacCtrl+Shift+1` | 全屏截图并识别 |
| `Ctrl+Shift+2` / macOS `MacCtrl+Shift+2` | 进入区域选择并识别 |
| `Ctrl+Shift+3` / macOS `MacCtrl+Shift+3` | 切换到下一个 AI 配置 |
| `Ctrl+Shift+4` / macOS `MacCtrl+Shift+4` | 请求中取消；已有结果时清除识别结果 |

识别过程中，状态栏会依次显示 `截图中... → 裁剪中...（区域识别时）→ AI识别中... → 识别完成`，进度清晰可追溯。

## 📁 项目结构

```
exampilot/
├── manifest.json            # Manifest V3 扩展清单
├── package.json             # 构建脚本与依赖
├── scripts/
│   └── build.mjs            # esbuild 打包脚本
├── background/
│   ├── index.js             # SW 入口：消息路由与流程编排
│   ├── query-ai.js          # AI API 调用模块（内置模式 + 自定义模板）
│   ├── request-overrides.js # 自定义请求头/请求体 JSON 覆盖处理
│   ├── settings-transfer.js # 设置备份的创建、校验与导入归一化
│   └── template-engine.js   # 自定义模板渲染与响应提取
├── content/
│   ├── index.js             # 内容脚本入口（esbuild 构建入口）
│   ├── frame-cursor.js      # iframe 光标桥接：隐藏子 frame 原生光标并逐层上报坐标
│   ├── ui.js                # Preact+htm 浮动面板组件（Shadow DOM）
│   └── ui-opacity.js        # 界面透明度偏好归一化与应用
├── icons/                   # 扩展图标（16/48/128）
├── docs/                    # 营销落地页与隐私政策
├── dist/chrome/             # 普通版构建输出目录（已 gitignore，加载扩展时选择此目录）
├── dist/chrome-full/        # Full Access 版构建输出目录（已 gitignore）
│   ├── background/index.js
│   ├── content/bundle/content-bundle.js
│   ├── content/bundle/frame-cursor-bundle.js
│   ├── manifest.json
│   └── icons/
├── .claude/                 # Claude Code 配置与记忆
├── AGENTS.md                # Codex 指令（与 CLAUDE.md 同步）
├── CLAUDE.md
├── README.md
└── LICENSE
```

## ⚙️ 配置说明

AI 配置通过面板右下角的 **⚙️ 设置** 按钮管理，支持添加多个视觉大模型配置并随时切换。每项包含 `name`、`url`、`model`、`apiKey`、`apiMode`，自定义模板模式还会保存 `templateHeadersJson`、`templateBodyJson`、`templateResponseText`。接口地址必须使用 HTTPS。支持四种接口模式：

- **Chat Completions** — 标准 OpenAI 兼容接口 (`/v1/chat/completions`)
- **Responses API** — OpenAI Responses API (`/v1/responses`)
- **Anthropic Claude** — Anthropic Messages API (`/v1/messages`)
- **自定义模板** — 手写 Headers/Body JSON 模板和响应提取模板，适配任意兼容视觉输入的 HTTPS API

新增配置自动设为当前使用（`selected: true`）。

### 🔐 访问权限

项目支持两种构建：

- **普通版**（`npm run build` / `npm run build:package`）：`manifest.json` 保持商店友好的低权限策略，使用 `activeTab` + `scripting` 在点击图标后注入隐藏面板，并通过 `optional_host_permissions` 对 API 域名按需授权。静默模式检测到跨域 iframe（包括开启后动态加载或换址的 iframe）时，也会单独请求该 iframe 的 HTTPS 域名授权，以便持续隐藏原生光标和跟踪仿光标坐标。请求权限完成后仍保持隐藏，用户双击页面才显示。
- **Full Access 版**（`npm run build:full` / `npm run build:full:package`）：构建脚本生成带 `content_scripts` 和 `host_permissions: ["<all_urls>"]` 的清单。进入任意网页后会自动加载隐藏面板，并在所有 frame 中自动加载光标桥接脚本；点击扩展图标或双击页面空白区域显示，配置、识别和跨域 iframe 静默模式流程均不再弹出域名单独授权框。

### 🔧 自定义请求头与请求体

每个 AI 配置支持添加**自定义 HTTP 请求头（Headers JSON）** 和 **自定义请求体（Body JSON）**，满足不同 API 的特殊需求：

- **请求头示例**：设置 `anthropic-version: 2023-06-01` 等供应商特定参数
- **请求体示例**：添加 `max_tokens: 4096`、`temperature: 0.7` 等推理参数
- Body 以 JSON 对象解析：数字、布尔值、数组、对象会保留 JSON 原始类型；加引号的值会作为字符串发送
- 对象递归合并，数组和基础类型替换默认值，字段值为 `null` 可删除默认字段
- 切换 API 模式时，Anthropic 模式自动填充 `anthropic-version` 请求头和 `max_tokens` 请求体字段
- 配置列表项会显示已配置的 JSON 覆盖或模板部分，一目了然

### 🧩 自定义模板模式

当供应商的请求格式无法通过内置三种模式或 JSON 覆盖表达时，可选择 **自定义模板**：

- **Headers 模板** 和 **Body 模板** 必须渲染为合法 JSON；Headers 必须是 JSON 对象
- 模板支持 `{{model}}`、`{{apiKey}}`、`{{apiKeyBearer}}`、`{{prompt}}`、`{{imageUrl}}`、`{{imageBase64}}`、`{{base64Image}}`、`{{imageMimeType}}`、`{{mimeType}}` 等占位符
- 如果某个字段完全等于一个占位符，渲染时会保留原始类型；例如对象、数组、数字不会被强制转成字符串
- **响应模板** 用于从供应商返回 JSON 中提取答案文本，适合不同厂商的自定义响应结构
- 保存配置前会先渲染并校验模板，错误会以普通 UI 错误提示展示

### 👁️ 请求预览

在发送截图请求前，可展开 **请求预览** 面板查看即将发出的完整 API 请求结构（含合并后的请求头、请求体、模板渲染结果和图片数据），方便调试和确认配置正确性。

### ✏️ 自定义提示词

在 ⚙️ 设置页面底部可编辑**发送给 AI 的提示词**，支持自由修改指令格式。提示词独立存储（不与 AI 配置绑定），修改后全局生效。

### 🕶️ 静默模式

在 ⚙️ 设置页面的 **🎨 界面设置** 中可开启全局静默模式。该开关独立于单个 AI 配置，默认关闭；关闭时完全沿用普通模式，在面板中展示 AI 返回的文本答案。

开启静默模式后，识别流程会要求 AI 返回结构化 JSON：

- 选择题返回 `items` 数组，每一项包含答案文本，以及 `coordinatePercent` 或 `bboxPercent` 百分比坐标（0 到 1）
- 全屏截图时百分比基于当前视口；区域截图时百分比基于裁剪后的选区，后台会转换回页面视口坐标
- 页面会为每个答案创建透明命中区；鼠标进入并短暂停留后，会以仿光标轻微位移提供触发反馈
- 目标位于跨域 iframe 时，普通版会显示“授权 iframe 域名”窗口；授权后子 frame 会隐藏原生光标并把坐标传回顶层仿光标。刷新扩展后还需刷新网页，才能替换已注入的旧脚本
- “显示静默框”只控制是否画出红色调试框；关闭后命中区和悬浮反馈仍然有效
- 简答题、填空题、编程题等没有可悬浮选项时，AI 不应编造坐标，而应返回 `clipboardOnly: true`，扩展会把答案复制到剪切板

静默模式下可单独编辑 **静默提示词**。如果自定义模板模式也开启静默模式，响应模板最终提取出的文本仍必须是符合约定的 JSON，否则会显示可读错误提示。

### 🎛️ 界面透明度

在 ⚙️ 设置页面的 **🎨 界面设置** 中可调节悬浮面板透明度、仿光标大小与样式、静默模式开关和静默调试框显示。仿光标提供 MacOS 黑色白边与 Windows 风格白色黑边两种样式，仅在静默模式下接管系统光标；Windows 样式会移除阴影以保持边缘清晰。界面偏好存储在 `chrome.storage.local`，仅影响本地显示与交互，不会发送给 AI API 或任何第三方服务。

### 💾 配置迁移

在 ⚙️ 设置页面的 **配置迁移** 中可以备份或恢复设置：

- **导出配置**会下载一个带日期的 `exampilot-settings-YYYY-MM-DD.json` 文件，包含全部模型配置（含 API Key）、当前选中项、自定义提示词、静默模式提示词、静默模式设置和界面透明度
- **导入配置**会先校验备份格式、版本、HTTPS API 地址、接口模式和静默模式数值范围，再替换当前浏览器中的全部 ExamPilot 配置、提示词、静默模式设置与透明度
- 导入不会迁移 API 域名授权；在新设备或新浏览器中首次使用某个域名时，仍需点击授权
- 备份文件是可读的 JSON，包含未加密的 API Key。请保存在可信位置，不要分享到聊天、网盘公开链接或代码仓库

### 📍 面板位置

点击主面板的 **—** 可折叠为迷你 ⚡ 按钮。拖动迷你按钮即可调整面板位置；位置会以相对坐标保存在 `chrome.storage.local`，并在窗口尺寸变化时自动限制在可见区域内。面板位置不会包含在配置导出文件中。

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 🧩 扩展框架 | Chrome Extension Manifest V3 |
| 🎨 UI 框架 | Preact + htm（VDOM 渲染，Shadow DOM 样式隔离） |
| 🔨 构建工具 | esbuild（ESM → IIFE 打包） |
| 📡 图像传输 | base64 直传 AI |
| 🧠 视觉推理 | 视觉大模型（OpenAI 兼容 / Responses API / Anthropic / 自定义模板，模型与请求格式可配置） |
| ⚡ 扩展能力 | Service Worker · Content Script · Optional Host Permissions |

## 🤖 关于 AI

本项目由 **Claude（Anthropic）** 从第一行代码开始生成。

> 别问为什么代码写得这么好 —— 问就是 Claude 写的，改 bug 也得找 Claude，别来问我，我只会按截图发需求和提出问题。

## 📄 许可证

[MIT](LICENSE)
