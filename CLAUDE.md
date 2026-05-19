# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# ExamPilot Extension

Chrome Extension (Manifest V3) that captures viewport screenshots and analyzes via vision LLM API (OpenAI-compatible). Images are sent as base64 directly to the API. UI built with Preact + htm (tagged-template VDOM), bundled via esbuild. No test or lint tooling is configured.

Build output goes to `dist/chrome/`. **Load `dist/chrome/`** (not project root) as the unpacked extension.

## Commands

| Action | How |
|--------|------|
| Install dependencies | `npm install` |
| Build | `npm run build` |
| Build (no minify, for debugging) | `npm run build:package` |
| Load extension | Chrome → Extensions (`chrome://extensions`) → "Load unpacked" → select `dist/chrome/` |
| Reload after changes | `npm run build` then `chrome://extensions` → refresh icon on extension card |
| Debug background SW | Extension card → "Service Worker" link → opens DevTools console |
| Inspect content script | DevTools on any page → Console → select "exampilot-extension" context |

## Architecture

**Data flow:** User clicks "开始识别" → content script sends `{action:'captureAndAnalyze'}` → background service worker captures screenshot → sends image as base64 to vision LLM API → returns answer to content script.

```
Content Script                          Background SW
┌─────────────────┐   runtime.sendMessage   ┌─────────────────┐
│ content/index.js │ ─── captureAndAnalyze ─▶│ background/index│
│ content/ui.js    │ ◀── status/sendResponse─│       .js       │
└─────────────────┘                         │ query-ai.js     │
                                            └─────────────────┘
```

**Message flow:**
- Content → background: `chrome.runtime.sendMessage({ action: 'captureAndAnalyze' })`
- Background → content: `chrome.tabs.sendMessage(tabId, { action: 'status', message })` for real-time progress
- Errors: always propagate via `sendResponse({ success: false, error })` for content script UI display

## Key Files

| File | Role |
|------|------|
| `background/index.js` | Service Worker entry. `importScripts()` loads modules. Routes 'captureAndAnalyze' messages. Config CRUD handlers. Startup initialization (`ensureConfigInitialized`, `ensurePromptInitialized`) |
| `background/query-ai.js` | Calls vision LLM API with image URL, returns AI answer. Dispatches to `callChatCompletions()`, `callResponsesAPI()`, or `callAnthropicAPI()` based on `config.apiMode` |
| `content/index.js` | Content script entry (esbuild entry point). Creates host `<div>`, calls `mountPanel()`, handles double-click toggle |
| `content/ui.js` | Preact+htm panel component with Shadow DOM isolation. All CSS in `<style>` inside the template. Config management CRUD via `chrome.runtime.sendMessage` |
| `scripts/build.mjs` | esbuild build script. Cleans `dist/`, bundles content script + background files, copies manifest.json + icons to `dist/chrome/` |
| `content/bundle/content-bundle.js` | esbuild output (IIFE). What `manifest.json` points to |
| `package.json` | Build scripts and dependencies (preact, htm, esbuild) |
| `manifest.json` | MV3 config. `permissions: ["storage", "activeTab", "scripting"]`, `host_permissions: ["<all_urls>"]` |
| `AGENTS.md` | Instructions file for Codex (not Claude Code). Keep in sync when updating CLAUDE.md |

## Key Patterns & Gotchas
- **Programmatic content script injection** — Content script is NOT declared in manifest.json via `content_scripts`. It's injected on-demand via `chrome.action.onClicked.addListener` → `chrome.scripting.executeScript`. Panel only appears after user clicks the extension icon. Content script world does NOT exist on page load.
- **CSS isolation via Shadow DOM** — Panel is inside `host.attachShadow({mode:'open'})`. CSS uses `:host` pseudo-class for container + scoped class selectors inside shadow root. All styles in `<style>` tag inside the component template.
- **CSS utility classes** — Use predefined `exmp-*` utility classes for layout/spacing: `exmp-flex`, `exmp-flex-col`, `exmp-items-center`, `exmp-justify-between`, `exmp-gap-6`, `exmp-w-full`, `exmp-p-8-14`, `exmp-p-6-14`, `exmp-text-11`, `exmp-text-12`, `exmp-text-13`, `exmp-rounded-8`. Defined at top of the `<style>` block. Only write dedicated CSS for unique patterns.
- **Screenshot panel-hiding** — The panel must be hidden before `captureVisibleTab()`. `sendStatus('截图中...')` must be `await`ed to give the content script time to hide the panel before the screenshot is taken. Other status messages don't need await. The content script's status listener auto-reveals the panel on the next non-screenshot status message.
- **`importScripts()`** — MV3 service worker uses `importScripts()` (not ES modules) for loading. Files are concatenated in global scope.
- **`importScripts` function timing** — Functions defined in `background/index.js` after `importScripts()` (e.g., `getActiveConfig`) are available to imported scripts (e.g., `query-ai.js`) at **call time**, not definition time. `queryAI()` calls `getActiveConfig()` at runtime, by which point it exists globally.
- **AI answer HTML rendering** — AI returns HTML with `<b>`, `<br>` etc. Rendered via Preact's `dangerouslySetInnerHTML`. Output from trusted AI API — same risk profile as innerHTML.
- **Error propagation** — All errors (API call failure, missing config) propagate back to content script via `sendResponse({success:false, error})` for UI display.
- **Responses API output structure** — `/v1/responses` `output` array can have mixed types (e.g. `reasoning` + `message`). Must find entry with `item.type === 'message'` to read `content[0].text`. Don't assume `output[0]` is the answer.
- **Anthropic Messages API content structure** — `/v1/messages` response `content` array can have mixed types (e.g. `thinking` + `text`). Must find entry with `item.type === 'text'` to read `.text`. Don't assume `content[0]` is the answer.
- **Anthropic image format differs** — Anthropic API expects raw base64 (no `data:image/...` prefix). The `callAnthropicAPI()` strips the JPEG prefix via `.replace(/^data:image\/jpeg;base64,/, '')` and sends `{type: 'image', source: {type: 'base64', media_type: 'image/jpeg', data: <raw>}}`. Other API modes pass the data URL as-is.
- **CORS in MV3 service worker** — `fetch()` from service worker is subject to CORS. Custom proxy endpoints need `host_permissions` in `manifest.json`.
- **Config management** — Configs stored in `chrome.storage.local` (survives SW restart). `addConfig` auto-selects the new config (`selected: true`). Deleting the selected config shifts selection to the first remaining. Config list item shows custom headers/body field counts.
- **Config message actions** — Content↔background CRUD: `getConfigs`, `getConfig` (auto-defaults `apiMode`/`customHeaders`/`customBodyFields` for old data), `setActiveConfig`, `addConfig` (pushes with `selected: true`), `editConfig`, `deleteConfig` (shifts selection if deleted was selected).
- **Config view inline handlers** — Config list uses inline Preact event bindings (`onClick=${handler}`) with `stopPropagation()` on edit/delete buttons. No delegation needed.
- **Preact + htm** — `import htm from 'htm'` + `const html = htm.bind(h)` provides tagged-template syntax instead of JSX. No JSX transform needed. `useState`, `useEffect` from `'preact/hooks'`.
- **Hooks without destructuring** — Codebase uses `var` (not `const/let`) and avoids destructuring. Pattern: `var _a = useState(initial), value = _a[0], setValue = _a[1]`. Don't use `const [value, setValue] = useState()`.
- **Three panel view states** — `viewState` controls which UI is shown: `mini` (collapsed ⚡ button, 44×44px circle), `main` (answers view with answer area + status bar + footer controls), `config` (settings view with config list/form, custom headers/body, prompt editor).
- **Bundle size reference** — `npm run build` produces ~40KB (Preact+htm). Content script loads this single bundle.
- **No customElements.define** — Chrome content script isolated worlds have `customElements === null`. Panel is a functional component mounted into shadow root, not a custom element. Mounted via Preact's `render()`.
- **Storage migration pattern** — `ensureConfigInitialized()` checks `configList[0].selected === undefined` to detect old-format data and migrates in-place. `ensurePromptInitialized()` follows the same detect-and-initialize pattern for `customPrompt`. Future storage changes should follow the same pattern.
- **Custom prompt storage** — `customPrompt` is a separate string key in `chrome.storage.local` (not in configList). Initialized by `ensurePromptInitialized()`. Message handlers: `getPrompt` (read), `setPrompt` (write). UI is a textarea in the config view.
- **UI loading state catch safety** — Any function that sets a UI-locking state (e.g., `setPromptSaving(true)`) MUST have a `.catch()` that resets the state, or the UI element can get permanently stuck if the Promise rejects.
- **Custom body field numeric auto-conversion** — In `query-ai.js`, custom body field values that parse as valid numbers are auto-converted to numeric types in the JSON body. Affects all three API modes.
- **Anthropic config auto-fill** — When `apiMode` switches to `anthropic` on a new config (no existing custom headers/body fields), the UI auto-populates `anthropic-version: 2023-06-01` header and `max_tokens: 4096` body field.
- **Git remote** — Gitee, not GitHub.
- **`build:package` strips host_permissions** — `npm run build:package` (NO_MINIFY=true) deletes `host_permissions` from manifest.json for Chrome Web Store compliance. Development builds (`npm run build`) retain it.
- **Config ID format** — Generated in background as `'cfg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)` in `addConfig` handler.
- **`docs/` folder** — Contains `index.html` (landing/marketing page) and `privacy.html` (privacy policy). Not part of extension build output. Load `dist/chrome/` as unpacked extension, not `docs/`.
- **Extension load path** — Build output goes to `dist/chrome/`. When testing, **load `dist/chrome/`** (not project root) as unpacked extension in `chrome://extensions`. The manifest at project root references `content/bundle/content-bundle.js` which only exists inside `dist/chrome/` after build.
- **Build output structure** — After `npm run build`, all files in `dist/chrome/`: `background/index.js` (bundled from background/index.js + query-ai.js), `content/bundle/content-bundle.js` (bundled from content/index.js + ui.js), `manifest.json`, `icons/`.
- **AbortController request cancellation** — `captureAndAnalyze()` stores a global `currentAbortController`. On each new call, `currentAbortController.abort()` cancels the previous in-flight fetch. The `AbortError` is caught and rethrown as `'已取消'`. Pattern: save reference → abort old → create new → pass `signal` → cleanup in `finally` if own signal is still current.
- **Content script request sequence guard** — `handleStartCapture` increments `currentRequestSeq` each call. `then`/`catch` callbacks check `mySeq !== currentRequestSeq` to discard stale responses from prior requests. The `setCapturing(false)` reset is also guarded by the same check.
- **`apiFetch` CORS error wrapper** — `apiFetch()` in `query-ai.js` catches `TypeError` from `fetch()` and rethrows with a Chinese-language message about checking CORS / URL correctness. MV3 service worker `fetch()` is subject to CORS — unlike MV2 background pages.
- **`buildApiError` dual-format error parsing** — `buildApiError()` in `query-ai.js` handles both OpenAI format (`{error: {message}}` or `{error: "str"}`) and Anthropic format (`{message: "str"}`), with text fallback. Used in all three API mode handlers.
- **`:host { all: initial }` in Shadow DOM** — The panel's `:host` sets `all: initial` to reset browser defaults on the shadow root host element. Even though Shadow DOM provides style isolation, `all: initial` ensures the host itself inherits no page styles. Combined with explicit `font-family`, `font-size`, `color` on `:host` and `box-sizing: border-box` on `*`.
