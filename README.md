# ExamPilot — 智能解题引擎

**基于视觉 AI 的实时答题系统**：一键截图，精准识别网页题目，调用大模型实时推理，秒级获取答案与解析。

---

## 概述

ExamPilot 是一款 Chrome 浏览器扩展，能够在任意网页中**即时截取当前视口**，借助视觉大模型自动识别题目并生成高精度答案。无需手动输入，无需切换页面，让知识获取零摩擦。

## 工作流程

```
用户触发识别
      │
      ▼
  截图 ──▶ 视觉 AI 推理
      │
      ▼
  浮动面板呈现 AI 解析结果
```

### 核心链路

| 阶段 | 技术实现 | 说明 |
|------|---------|------|
| **截图** | `chrome.tabs.captureVisibleTab` | 捕获当前浏览器视口，无损截图 |
| **推理** | 视觉大模型（OpenAI 兼容 / Anthropic 直接 API） | 理解题目内容并推理作答（模型可配置） |
| **展示** | 浮动交互面板 | 页面右下角实时展示识别进度与结果 |

## 快速开始

### 安装

```bash
# 1. 克隆项目
git clone <repo-url>
cd exampilot-extension

# 2. 安装依赖并构建
npm install
npm run build

# 3. 加载到 Chrome
#    打开 chrome://extensions → 开启开发者模式 → 加载已解压的扩展 → 选择本项目目录
```

### 使用方式

| 操作 | 说明 |
|------|------|
| 点击扩展工具栏图标 | 呼出浮动面板 |
| 双击页面空白区域 | 切换面板显示 / 隐藏 |
| 点击 **开始识别** | 触发截图 → 上传 → AI 推理全流程 |
| 点击 **清除** | 清空当前识别结果 |
| 点击 **⚙️ 设置** | 管理 AI 配置：添加/编辑/删除/切换视觉大模型 |
| 在 ⚙️ 中编辑提示词 | 自定义发送给 AI 的指令，支持多行文本，自动保存 |
| 按 **← 返回** | 从配置管理返回主面板 |

识别过程中，状态栏会依次显示 `截图 → AI 识别中 → 完成`，进度透明可追溯。

## 项目结构

```
exampilot-extension/
├── manifest.json            # Manifest V3 扩展清单
├── package.json             # 构建脚本与依赖
├── background/
│   ├── index.js             # 服务入口：消息路由与流程编排
│   └── query-ai.js          # AI API 调用模块（OpenAI 兼容 / Responses API / Anthropic）
├── content/
│   ├── index.js             # 内容脚本入口（ESM，esbuild 构建入口）
│   ├── ui.js                # Preact+htm 浮动面板组件（Shadow DOM）
│   └── bundle/
│       └── content-bundle.js # 构建产物（IIFE，content script 加载）
├── icons/
│   └── icon128.png
├── node_modules/            # 依赖（已 gitignore）
├── CLAUDE.md
└── README.md
```

## 配置说明

AI 配置通过面板右下角的 **⚙️ 设置** 按钮管理，支持添加多个视觉大模型配置并随时切换。每项包含 `name`、`url`、`model`、`apiKey`、`apiMode`。支持三种接口模式：

- **Chat Completions** — 标准 OpenAI 兼容接口 (`/v1/chat/completions`)
- **Responses API** — OpenAI Responses API (`/v1/responses`)
- **Anthropic Claude** — Anthropic 直接 API (`/v1/messages`)，需额外配置 `anthropicVersion` 和 `maxTokens`

新增配置自动设为当前使用（`selected: true`）。

### 自定义提示词

在 ⚙️ 设置页面底部可编辑**发送给 AI 的提示词**，支持自由修改指令格式。提示词独立存储（不与 AI 配置绑定），修改后全局生效。

## 技术栈

| 层级 | 技术 |
|------|------|
| 扩展框架 | Chrome Extension Manifest V3 |
| UI 框架 | Preact + htm（VDOM 渲染，Shadow DOM 样式隔离） |
| 构建工具 | esbuild（ESM → IIFE 打包） |
| 图像传输 | base64 直传 AI |
| 视觉推理 | 视觉大模型（OpenAI 兼容 / Anthropic 直接 API，模型可配置） |
| 扩展能力 | Service Worker · Content Script |

## 🤖 关于 AI

本项目由 **Claude（Anthropic）** 从第一行代码开始生成。

> 别问为什么代码写得这么好 —— 问就是 Claude 写的，改 bug 也得找 Claude，别来问我，我只会按截图发需求和提出问题。

## 许可证

[MIT](LICENSE)
