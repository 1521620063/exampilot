# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# ExamPilot Extension

Chrome Extension (Manifest V3) that captures viewport screenshots and analyzes via vision LLM API (OpenAI-compatible). Images are sent as base64 directly to the API. UI built with Preact + htm (tagged-template VDOM), bundled via esbuild. Tests use Node's built-in `node --test` runner.

Default build output goes to `dist/chrome/`. Full Access build output goes to `dist/chrome-full/`. **Load the desired dist directory** (not project root) as the unpacked extension.

## Commands

| Action | How |
|--------|------|
| Install dependencies | `npm install` |
| Build default optional-permission version | `npm run build` → `dist/chrome/` |
| Build Full Access version | `npm run build:full` → `dist/chrome-full/` |
| Package build (no minify, Chrome Web Store friendly) | `npm run build:package` (cross-platform `cross-env NO_MINIFY=true`) |
| Test | `npm test` |
| Load extension | Chrome → Extensions (`chrome://extensions`) → "Load unpacked" → select `dist/chrome/` |
| Reload after changes | `npm run build` then `chrome://extensions` → refresh icon on extension card |
| Debug background SW | Extension card → "Service Worker" link → opens DevTools console |
| Inspect content script | DevTools on any page → Console → select "exampilot-extension" context |

## Architecture

**Data flow:** In the default build, user clicks extension icon → background injects the content script with `chrome.scripting.executeScript()` → hidden panel is mounted; user double-clicks the page to show it. In the Full Access build, manifest `content_scripts` auto-loads the hidden panel on supported pages → user clicks the extension icon or double-clicks the page to show it. Then user clicks "全屏"/"区域" → content script sends `{action:'captureAndAnalyze'}` → background service worker captures screenshot → sends image as base64 to vision LLM API → returns answer to content script.

```
Content Script                          Background SW
┌─────────────────┐   runtime.sendMessage   ┌─────────────────┐
│ content/index.js │ ─── captureAndAnalyze ─▶│ background/index│
│ content/ui.js    │ ◀── status/sendResponse─│       .js       │
└─────────────────┘                         │ query-ai.js     │
                                            └─────────────────┘
```

**Message flow:**
- Content → background: `chrome.runtime.sendMessage({ action: 'checkApiHostPermission', url })` before saving configs or starting capture in the default build; Full Access returns granted immediately
- Content → background: `chrome.runtime.sendMessage({ action: 'captureAndAnalyze' })` (full viewport screenshot)
- Content → background: `chrome.runtime.sendMessage({ action: 'captureAndAnalyzeWithRect', rect: {x,y,width,height,dpr} })` (region selection — background crops via `cropImage()` using OffscreenCanvas + createImageBitmap)
- Content → background: `chrome.runtime.sendMessage({ action: 'cancelCapture' })` for explicit cancellation
- Background → content: `chrome.tabs.sendMessage(tabId, { action: 'status', message })` for real-time progress
- Errors: always propagate via `sendResponse({ success: false, error })` for content script UI display

## Key Files

| File | Role |
|------|------|
| `background/index.js` | Service Worker entry. `importScripts()` loads modules. Routes 'captureAndAnalyze' messages. Config CRUD handlers. Startup initialization (`ensureConfigInitialized`, `ensurePromptInitialized`) |
| `background/request-overrides.js` | Parses advanced Headers/Body JSON overrides and deep-merges them into default requests |
| `background/template-engine.js` | Renders custom request JSON templates and extracts final answer text from custom response templates |
| `background/query-ai.js` | Calls vision LLM API with image URL, returns AI answer. Dispatches to `callChatCompletions()`, `callResponsesAPI()`, `callAnthropicAPI()`, or custom template handling based on `config.apiMode` |
| `content/index.js` | Content script entry (esbuild entry point). Creates host `<div>`, calls `mountPanel()`, handles double-click toggle |
| `content/ui.js` | Preact+htm panel component with Shadow DOM isolation. All CSS in `<style>` inside the template. Config management CRUD, region selection, request preview, prompt editor, and UI opacity slider |
| `content/ui-opacity.js` | Normalizes and applies global panel opacity (`uiOpacity`) stored in `chrome.storage.local` |
| `permission/host-permission.html` | Extension page embedded in the current tab as an iframe for optional host permission grants in the default build |
| `permission/host-permission.js` | Handles `chrome.permissions.request()` inside the iframe button click and reports results via `postMessage` |
| `scripts/build.mjs` | esbuild build script. Cleans the target dist directory, bundles content/background files with `__EXAMPILOT_FULL_ACCESS__`, copies assets, and derives the Full Access manifest when `BUILD_MODE=full` |
| `content/bundle/content-bundle.js` | esbuild output (IIFE). Default build injects it programmatically; Full Access build auto-loads it via `content_scripts` |
| `package.json` | Build scripts and dependencies (preact, htm, esbuild, cross-env) |
| `manifest.json` | Default MV3 config. `permissions: ["storage", "activeTab", "scripting", "clipboardWrite"]`, `optional_host_permissions: ["https://*/*"]`; Full Access manifest is generated into `dist/chrome/manifest.json` |
| `AGENTS.md` | Instructions file for Codex (not Claude Code). Keep in sync when updating CLAUDE.md. |
| `.gitignore` | Ignores `config.js` (possible local config file), `node_modules/`, `dist/`, `.claude` |

## Key Patterns & Gotchas
- **Dual permission builds** — Default build uses `activeTab` + `scripting` and injects a hidden content script on toolbar click; users double-click the page to show it. Full Access build is selected with `BUILD_MODE=full`; the build script removes `scripting`, adds `content_scripts`, and adds `host_permissions: ["<all_urls>"]`. Both builds share the same source via `__EXAMPILOT_FULL_ACCESS__`.
- **Auto-loaded hidden content script in Full Access** — Full Access content script runs at `document_idle` and creates `#exmp-container` with `display: none`, so the panel is present but hidden by default. Clicking the extension icon or double-clicking the page toggles visibility; it does not start screenshot capture.
- **CSS isolation via Shadow DOM** — Panel is inside `host.attachShadow({mode:'open'})`. CSS uses `:host` pseudo-class for container + scoped class selectors inside shadow root. All styles in `<style>` tag inside the component template.
- **CSS utility classes** — Use predefined `exmp-*` utility classes for layout/spacing: `exmp-flex`, `exmp-flex-col`, `exmp-items-center`, `exmp-justify-between`, `exmp-gap-6`, `exmp-w-full`, `exmp-p-8-14`, `exmp-p-6-14`, `exmp-text-11`, `exmp-text-12`, `exmp-text-13`, `exmp-rounded-8`. Defined at top of the `<style>` block. Only write dedicated CSS for unique patterns.
- **Screenshot panel-hiding** — The panel must be hidden before `captureVisibleTab()`. `sendStatus('截图中...')` must be `await`ed to give the content script time to hide the panel before the screenshot is taken. Other status messages don't need await. The content script's status listener auto-reveals the panel on the next non-screenshot status message.
- **`importScripts()`** — MV3 service worker uses `importScripts()` (not ES modules) for loading. Files are concatenated in global scope.
- **`importScripts` function timing** — Functions defined in `background/index.js` after `importScripts()` (e.g., `getActiveConfig`) are available to imported scripts (e.g., `query-ai.js`) at **call time**, not definition time. `queryAI()` calls `getActiveConfig()` at runtime, by which point it exists globally.
- **AI answer HTML rendering** — AI returns limited HTML with `<b>`, `<br>` etc. Sanitize output before rendering with Preact's `dangerouslySetInnerHTML`, because the API endpoint is user-configurable.
- **Error propagation** — All errors (API call failure, missing config) propagate back to content script via `sendResponse({success:false, error})` for UI display.
- **Region selection overlay on `document.body`** — The region selection UI creates a `<div>` + `<style>` on `document.body` (not inside Shadow DOM, since the overlay must cover the entire page). Managed via `useEffect` that creates elements on mount and removes them on cleanup (`overlayEl.parentNode.removeChild`). CSS classes: `exmp-selection-overlay` (full-viewport transparent, z-index 2147483646), `exmp-selection-box` (dashed border rectangle), `exmp-selection-corner-*` (four corner handles). Mouse events (`mousedown`/`mousemove`/`mouseup`) stored on `box._startX`/`_startY` custom properties.
- **Request preview in config form** — Config form has an expandable request preview section (controlled by `showPreview` state) that renders a `<pre>` block with constructed headers and body JSON. In custom-template mode it previews rendered Headers/Body templates and the response template. Useful before sending first request to a new API endpoint. Preview is generated by inline IIFEs inside the template.
- **`cropImage()` in background** — Uses `fetch()` + `createImageBitmap()` to decode, then `OffscreenCanvas` + `canvas.convertToBlob()` + `FileReader.readAsDataURL()` to re-encode cropped JPEG (`quality: 0.9`). Coordinates multiplied by `devicePixelRatio` for physical pixels. Includes boundary clamping to prevent out-of-range reads.
- **Responses API output structure** — `/v1/responses` `output` array can have mixed types (e.g. `reasoning` + `message`). Must find entry with `item.type === 'message'` to read `content[0].text`. Don't assume `output[0]` is the answer.
- **Anthropic Messages API content structure** — `/v1/messages` response `content` array can have mixed types (e.g. `thinking` + `text`). Must find entry with `item.type === 'text'` to read `.text`. Don't assume `content[0]` is the answer.
- **Anthropic image format differs** — Anthropic API expects raw base64 (no `data:image/...` prefix). The `callAnthropicAPI()` strips the JPEG prefix via `.replace(/^data:image\/jpeg;base64,/, '')` and sends `{type: 'image', source: {type: 'base64', media_type: 'image/jpeg', data: <raw>}}`. Other API modes pass the data URL as-is.
- **Optional API host permissions** — Default build uses `optional_host_permissions: ["https://*/*"]` and checks the configured API URL as `https://hostname/*` before saving configs or starting capture. Missing permission is handled by `content/ui.js` creating `#exmp-permission-overlay` and embedding `permission/host-permission.html?embed=1&origin=...`.
- **Full Access host permissions** — `host_permissions: ["<all_urls>"]` is generated only for Full Access builds so the content script can auto-load on arbitrary pages and the service worker can call user-configured API hosts without runtime permission prompts.
- **CORS in MV3 service worker** — `fetch()` from service worker can still fail because of API CORS/network behavior. `apiFetch()` wraps common `TypeError` failures into a user-facing Chinese error message.
- **Advanced request JSON overrides** — Configs store `customHeadersJson` and `customBodyJson` strings, not key/value row arrays. `background/request-overrides.js` parses them as JSON objects and deep-merges them after the default headers/body are built. Objects merge recursively, arrays and primitives replace existing values, and `null` deletes a field. Invalid JSON must surface as a normal `sendResponse({success:false, error})` failure.
- **Custom template API mode** — `apiMode: 'custom-template'` stores `templateHeadersJson`, `templateBodyJson`, and `templateResponseText`. `background/template-engine.js` renders placeholders such as `{{model}}`, `{{apiKey}}`, `{{apiKeyBearer}}`, `{{prompt}}`, `{{imageUrl}}`, `{{imageBase64}}`, and `{{imageMimeType}}`. Headers must render to a JSON object; body can render to any JSON value; response template extracts the final answer from provider-specific JSON. Exact-placeholder values preserve their original type instead of becoming strings.
- **Config management** — Configs stored in `chrome.storage.local` (survives SW restart). `addConfig` auto-selects the new config (`selected: true`). Deleting the selected config shifts selection to the first remaining. Config list item shows whether headers/body JSON overrides or custom template parts are set.
- **Config message actions** — Content↔background CRUD: `getConfigs`, `getConfig` (auto-defaults `apiMode`/`customHeadersJson`/`customBodyJson`/template fields), `setActiveConfig`, `addConfig` (pushes with `selected: true`), `editConfig`, `deleteConfig` (shifts selection if deleted was selected).
- **Config view inline handlers** — Config list uses inline Preact event bindings (`onClick=${handler}`) with `stopPropagation()` on edit/delete buttons. No delegation needed.
- **Preact + htm** — `import htm from 'htm'` + `const html = htm.bind(h)` provides tagged-template syntax instead of JSX. No JSX transform needed. `useState`, `useEffect` from `'preact/hooks'`.
- **Hooks without destructuring** — Codebase uses `var` (not `const/let`) and avoids destructuring. Pattern: `var _a = useState(initial), value = _a[0], setValue = _a[1]`. Don't use `const [value, setValue] = useState()`.
- **Three panel view states** — `viewState` controls which UI is shown: `mini` (collapsed ⚡ button, 44×44px circle), `main` (answers view with answer area + status bar + footer controls), `config` (settings view with config list/form, advanced Headers/Body JSON override editors, prompt editor).
- **UI opacity preference** — `uiOpacity` is stored in `chrome.storage.local`, normalized by `content/ui-opacity.js` to `0.01..1`, applied directly to the Shadow DOM host, and synced via `chrome.storage.onChanged`. The slider lives in the config view under "🎨 界面设置".
- **Bundle size reference** — `npm run build` currently produces a ~58KB minified content bundle; `npm run build:package` produces a larger unminified bundle for package/debug review. Content script loads this single bundle.
- **No customElements.define** — Chrome content script isolated worlds have `customElements === null`. Panel is a functional component mounted into shadow root, not a custom element. Mounted via Preact's `render()`.
- **Storage migration pattern** — `ensureConfigInitialized()` checks `configList[0].selected === undefined` to detect old-format data and migrates in-place. `ensurePromptInitialized()` follows the same detect-and-initialize pattern for `customPrompt`. Future storage changes should follow the same pattern.
- **Custom prompt storage** — `customPrompt` is a separate string key in `chrome.storage.local` (not in configList). Initialized by `ensurePromptInitialized()`. Message handlers: `getPrompt` (read), `setPrompt` (write). UI is a textarea in the config view.
- **UI loading state catch safety** — Any function that sets a UI-locking state (e.g., `setPromptSaving(true)`) MUST have a `.catch()` that resets the state, or the UI element can get permanently stuck if the Promise rejects.
- **Custom body JSON types** — `customBodyJson` is parsed as JSON, so numeric literals remain numbers, booleans remain booleans, arrays/objects are preserved, and quoted values remain strings. There is no separate key/value-row numeric conversion layer.
- **Anthropic config auto-fill** — When `apiMode` switches to `anthropic` on a new config (no existing custom headers/body fields), the UI auto-populates `anthropic-version: 2023-06-01` header and `max_tokens: 4096` body field.
- **Git remote** — GitHub.
- **`build:package` and permissions** — `npm run build:package` creates the default optional-permission package. `npm run build:full:package` creates the unminified Full Access package.
- **Config ID format** — Generated in background as `'cfg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)` in `addConfig` handler.
- **`docs/` folder** — Contains `index.html` (landing/marketing page) and `privacy.html` (privacy policy). Not part of extension build output. Load `dist/chrome/` as unpacked extension, not `docs/`.
- **Extension load path** — Default builds write to `dist/chrome/`; Full Access builds write to `dist/chrome-full/`. When testing, load the desired dist directory, not the project root.
- **Build output structure** — Both dist directories contain `background/index.js`, `background/query-ai.js`, `content/bundle/content-bundle.js`, `permission/`, `manifest.json`, and `icons/`.
- **AbortController request cancellation** — `captureAndAnalyze()` stores a global `currentAbortController`. On each new call, `currentAbortController.abort()` cancels the previous in-flight fetch. The content script can also send `cancelCapture` to abort the active request. The `AbortError` is caught and rethrown as `'已取消'`. Pattern: save reference → abort old → create new → pass `signal` → cleanup in `finally` if own signal is still current.
- **Content script request sequence guard** — `handleStartCapture` increments `currentRequestSeq` each call. `then`/`catch` callbacks check `mySeq !== currentRequestSeq` to discard stale responses from prior requests. The `setCapturing(false)` reset is also guarded by the same check.
- **`apiFetch` CORS error wrapper** — `apiFetch()` in `query-ai.js` catches `TypeError` from `fetch()` and rethrows with a Chinese-language message about checking CORS / URL correctness. MV3 service worker `fetch()` is subject to CORS — unlike MV2 background pages.
- **`buildApiError` dual-format error parsing** — `buildApiError()` in `query-ai.js` handles both OpenAI format (`{error: {message}}` or `{error: "str"}`) and Anthropic format (`{message: "str"}`), with text fallback. Used in all three API mode handlers.
- **`:host { all: initial }` in Shadow DOM** — The panel's `:host` sets `all: initial` to reset browser defaults on the shadow root host element. Even though Shadow DOM provides style isolation, `all: initial` ensures the host itself inherits no page styles. Combined with explicit `font-family`, `font-size`, `color` on `:host` and `box-sizing: border-box` on `*`.
