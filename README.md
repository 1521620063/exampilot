# ExamPilot

ExamPilot 是一个基于视觉大模型的截图识别工具。本仓库同时维护 Chrome 插件和 Tauri 2 桌面应用，两端共用根目录的 Node.js 依赖与构建脚本。

当前版本：`1.8.0`

## 项目结构

```text
exampilot/
├─ assets/branding/       品牌原始图
├─ docs/                  项目主页、隐私政策和官网图片
├─ chrome-extension/   Chrome Manifest V3 插件源码
├─ desktop-app/       Tauri 2 桌面应用源码
│  ├─ src/            Preact 前端
│  ├─ src-tauri/      Rust 后端与 Tauri 配置
│  └─ test/           桌面前端测试
├─ package.json       两端统一的 npm 脚本和依赖
└─ package-lock.json  唯一的 npm 锁文件
```

请只在仓库根目录执行 `npm install`。子应用目录不维护独立的 `package.json`、`package-lock.json` 或 `node_modules`。

## 环境要求

- Node.js 20.19+、22.12+ 或更高版本
- Chrome 或其他兼容 Manifest V3 的 Chromium 浏览器
- 桌面端开发需要 Rust stable 工具链和对应平台的 Tauri 依赖
- 桌面端支持 Windows 与 macOS

## 安装依赖

```powershell
npm install
```

## Chrome 插件

插件支持全屏截图、区域截图、普通模式、静默模式、多 AI 配置、自定义提示词、自定义请求模板以及设置导入导出。

同时构建默认的按需授权版本和 Full Access 版本：

```powershell
npm run chrome:build
```

构建产物：

- 默认版本：`chrome-extension/dist/chrome/`
- Full Access 版本：`chrome-extension/dist/chrome-full/`

在 Chrome 中打开 `chrome://extensions`，启用“开发者模式”，点击“加载已解压的扩展程序”，选择上面的对应产物目录。不要直接选择 `chrome-extension/` 源码目录。

用于商店检查的非压缩构建：

```powershell
npm run chrome:build:package
```

## 桌面应用

桌面端通过系统级截图和真实鼠标位置工作，不依赖浏览器内容脚本。答案窗口透明、始终置顶，可覆盖浏览器全屏，并通过系统托盘打开独立设置窗口。

主要功能：

- 捕获鼠标所在显示器或选择屏幕区域
- 支持 OpenAI Chat Completions、Responses API、Anthropic Messages 和自定义 JSON 模板
- 普通模式在悬浮窗口中显示答案
- 静默模式隐藏答案窗口，通过原生命中区域检测真实鼠标悬停并反馈
- 无坐标的静默答案自动复制到剪贴板
- 多显示器和高 DPI 坐标换算
- 配置导入导出，兼容 `exampilot-settings-backup` v1
- 请求取消、错误记录和最近一次模型原始响应

启动桌面开发模式：

```powershell
npm run tauri:dev
```

只构建桌面前端：

```powershell
npm run desktop:build
```

构建桌面安装包：

```powershell
npm run tauri:build
```

桌面快捷键：

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+Shift+1` | 截取鼠标所在显示器并识别 |
| `Ctrl+Shift+2` | 选择屏幕区域并识别 |
| `Ctrl+Shift+3` | 切换到下一个 AI 配置 |
| `Ctrl+Shift+4` | 取消当前任务或清除结果 |

macOS 首次使用截图功能时需要授予“屏幕录制”权限；使用静默鼠标反馈时还需要授予“辅助功能”权限。

## 测试与构建

运行两端全部 Node.js 测试：

```powershell
npm test
```

构建 Chrome 插件和桌面前端：

```powershell
npm run build
```

运行 Rust 测试与静态检查：

```powershell
cargo test --manifest-path desktop-app/src-tauri/Cargo.toml
cargo fmt --manifest-path desktop-app/src-tauri/Cargo.toml --check
cargo clippy --manifest-path desktop-app/src-tauri/Cargo.toml --all-targets -- -D warnings
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run build` | 构建两个 Chrome 版本和桌面前端 |
| `npm test` | 运行两端 Node.js 测试 |
| `npm run chrome:build` | 构建 Chrome 默认版和 Full Access 版 |
| `npm run desktop:build` | 构建桌面前端 |
| `npm run tauri:dev` | 启动 Tauri 开发模式 |
| `npm run tauri:build` | 构建桌面安装包 |

## 配置说明

Chrome 插件和桌面应用的配置彼此独立，不会自动同步。可以通过设置页导出 JSON，再在另一端导入。API Key 等敏感配置保存在各自应用的本地存储中，请勿将导出的真实配置提交到 Git。

## License

[MIT](LICENSE)
