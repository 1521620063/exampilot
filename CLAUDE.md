# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# ExamPilot Extension

Chrome Extension (Manifest V3) that captures viewport screenshots and analyzes via vision LLM API (OpenAI-compatible). Images can be sent as base64 directly to the API, or uploaded to Aliyun OSS first (configurable via `UPLOAD_MODE`). Requires `npm run build` — UI built with Preact + htm (tagged-template VDOM), bundled via esbuild.

## Commands

| Action | How |
|--------|-----|
| Install dependencies | `npm install` |
| Build (esbuild) | `npm run build` |
| Watch mode | `npm run build:watch` |
| Load extension | Chrome → Extensions (`chrome://extensions`) → "Load unpacked" → select project root |
| Reload after changes | `npm run build` then `chrome://extensions` → refresh icon on extension card |
| Debug background SW | Extension card → "Service Worker" link → opens DevTools console |
| Inspect content script | DevTools on any page → Console → select "exampilot-extension" context |

## Architecture

**Data flow:** User clicks "开始识别" → content script sends `{action:'captureAndAnalyze'}` → background service worker captures screenshot → if `UPLOAD_MODE='oss'`, uploads to OSS via offscreen document → sends image (URL or base64) to vision LLM API (OpenAI-compatible) → returns answer to content script.

```
Content Script                          Background SW                  Offscreen Doc
┌─────────────────┐   runtime.sendMessage   ┌─────────────────┐   runtime.sendMessage   ┌──────────────┐
│ content/index.js │ ─── captureAndAnalyze ─▶│ background/index│ ─── uploadToOSS ────────▶│ offscreen.js │
│ content/ui.js    │ ◀── status/sendResponse─│       .js       │                        │ (OSS SDK)    │
└─────────────────┘                         │ upload.js       │                        └──────────────┘
                                            │ query-ai.js     │
                                            └─────────────────┘
```

**Message flow:**
- Content → background: `chrome.runtime.sendMessage({ action: 'captureAndAnalyze' })`
- Background → content: `chrome.tabs.sendMessage(tabId, { action: 'status', message })` for real-time progress
- Background → offscreen: `chrome.runtime.sendMessage({ action: 'uploadToOSS', dataUrl, ossConfig })`
- Errors: always propagate via `sendResponse({ success: false, error })` for content script UI display

## Key Files

| File | Role |
|------|------|
| `background/index.js` | Service Worker entry. `importScripts()` loads config + modules. Routes 'captureAndAnalyze' messages |
| `background/upload.js` | OSS upload. Creates/reuses offscreen document, delegates upload to it |
| `background/query-ai.js` | Calls vision LLM API with image URL, returns AI answer. Dispatches to `callChatCompletions()` or `callResponsesAPI()` based on `config.apiMode` |
| `content/index.js` | Content script entry (esbuild entry point). Creates host `<div>`, calls `mountPanel()`, handles double-click toggle |
| `content/ui.js` | Preact+htm panel component with Shadow DOM isolation. Functional component with hooks (`useState`, `useEffect`). All CSS in `<style>` inside the template. Config management CRUD via `chrome.runtime.sendMessage` |
| `content/bundle/content-bundle.js` | esbuild output (IIFE). What `manifest.json` points to |
| `package.json` | Build scripts (`npm run build`) and dependencies (preact, htm, esbuild) |
| `offscreen/offscreen.html` | Offscreen HTML page loading OSS SDK |
| `offscreen/offscreen.js` | OSS `client.put()` upload. Listens for 'uploadToOSS' messages |
| `config.js` | Config values (gitignored). `UPLOAD_MODE`, `OSS_CONFIG`, `API_CONFIG_LIST[]` — copy from `config-local.js` |
| `config-local.js` | Safe-to-commit template with placeholder values. Edit when config shape changes |
| `manifest.json` | MV3 config. `permissions: ["offscreen", "storage"]`, `host_permissions: ["<all_urls>"]` |

## Key Patterns & Gotchas

- **Config** — `config.js` is gitignored. `config-local.js` is the template. Never commit API keys. Configs are managed via `API_CONFIG_LIST[]` in storage; each item has a `selected: bool` field. Users add/switch/edit configs through the ⚙️ settings panel in the UI.
- **Offscreen API** — MV3 Service Worker can't use DOM-dependent SDKs. Offscreen document (`offscreen/offscreen.html`) loads Aliyun OSS SDK. **Gotcha:** `chrome.offscreen.createDocument()` errors must be caught silently — Chrome's actual error is "Only a single offscreen document may be created", not "already exists".
- **CSS isolation via Shadow DOM** — Panel is inside `host.attachShadow({mode:'open'})`. CSS uses `:host` pseudo-class for container + scoped class selectors inside shadow root. No more `all: initial` + `:where()` reset needed (shadow DOM provides native isolation). All styles in `<style>` tag inside the component template.
- **CSS utility classes** — To reduce repetitive CSS, use the predefined `exmp-*` utility classes in HTML templates: `exmp-flex`, `exmp-flex-col`, `exmp-items-center`, `exmp-justify-between`, `exmp-gap-6`, `exmp-w-full`, `exmp-p-8-14`, `exmp-p-6-14`, `exmp-text-11`, `exmp-text-12`, `exmp-text-13`, `exmp-rounded-8`. Defined at top of the `<style>` block inside the component template. Only write dedicated CSS when a pattern is truly unique — for layout, spacing, and alignment, prefer compositing utility classes.
- **Screenshot panel-hiding** — The panel must be hidden before `captureVisibleTab()`. `sendStatus('截图中...')` must be `await`ed to give the content script time to hide the panel before the screenshot is taken. Other status messages don't need await.
- **`importScripts()`** — MV3 service worker uses `importScripts()` (not ES modules) for loading. Files are concatenated in global scope.
- **`importScripts` function timing** — Functions defined in `background/index.js` after `importScripts()` (e.g., `getActiveConfig`) are available to imported scripts (e.g., `query-ai.js`) at **call time**, not definition time. `queryAI()` calls `getActiveConfig()` at runtime, by which point it exists globally.
- **AI answer HTML rendering** — AI returns HTML with `<b>`, `<br>` etc. Rendered via Preact's dangerouslySetInnerHTML directive in the component template. Same risk profile as original `innerHTML` — output from trusted AI API.
- **Error propagation** — All errors (OSS upload, API call failure) propagate back to content script via `sendResponse({success:false, error})` for UI display.
- **Responses API output structure** — `/v1/responses` `output` array can have mixed types (e.g. `reasoning` + `message`). Must find entry with `item.type === 'message'` to read `content[0].text`. Don't assume `output[0]` is the answer.
- **UPLOAD_MODE** — Config var (`'base64'` or `'oss'`) controlling image delivery. In `'base64'` mode, screenshot data URL goes directly to `queryAI()` and OSS/offscreen are skipped. In `'oss'` mode, screenshot is uploaded to OSS first, then the public URL is sent to the vision API. OpenAI-compatible vision APIs accept both `data:image/...` URLs and HTTP URLs in the `image_url` field.
- **Config management** — Configs stored in `chrome.storage.local` (survives SW restart). `API_CONFIG_LIST` in `config.js` only seeds first install. Users add/edit/delete configs via the ⚙️ button in the panel footer. `addConfig` auto-selects the new config (`selected: true`). Deleting the selected config shifts selection to the first remaining.
- **Config message actions** — Content↔background CRUD: `getConfigs` (list all), `getConfig` (single by id, auto-defaults `apiMode` for old data), `setActiveConfig` (sets `selected: true` on one, false on others), `addConfig` (pushes new item with `selected: true`), `editConfig` (updates name/url/model/apiKey/apiMode), `deleteConfig` (removes, shifts selection if deleted was selected).
- **Config view inline handlers** — Config list is rendered as Preact VDOM, so click handlers use inline Preact event bindings (`onClick=${handler}`) with `stopPropagation()` on edit/delete buttons. No delegation needed.
- **Preact + htm** — `import htm from 'htm'` + `const html = htm.bind(h)` provides tagged-template syntax instead of JSX. No JSX transform needed in esbuild. `useState`, `useEffect` from `'preact/hooks'`.
- **Hooks without destructuring** — Codebase uses `var` (not `const/let`) and avoids destructuring. Hooks pattern: `var _a = useState(initial), value = _a[0], setValue = _a[1]`. Don't use `const [value, setValue] = useState()`.
- **Bundle size reference** — `npm run build` produces ~40KB (Preact+htm) or ~30KB (lit-html only, see `refactor/lit-ui` branch). Content script loads this single bundle.
- **No customElements.define** — Chrome content script isolated worlds have `customElements === null`. Panel is a functional component mounted into shadow root, not a custom element. Mounted via Preact's `render(html`<${Panel} />`, shadowRoot)`.
- **Storage migration pattern** — `ensureConfigInitialized()` checks `configList[0].selected === undefined` to detect old-format data and migrates in-place. Future storage changes should follow the same detect-and-migrate pattern.
- **Git remote** — Gitee, not GitHub.
