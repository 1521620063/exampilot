# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

# ExamPilot Extension

Chrome Extension (Manifest V3) that captures viewport screenshots and selected regions, then analyzes them via a user-configured vision LLM API. Images are sent as base64 directly to the API. UI is built with Preact + htm (tagged-template VDOM), bundled via esbuild. Tests use Node's built-in `node --test` runner.

Build output goes to `dist/chrome/`. **Load `dist/chrome/`** (not the project root) as the unpacked extension.

## Commands

| Action | How |
|--------|-----|
| Install dependencies | `npm install` |
| Build | `npm run build` |
| Package build (no minify, Chrome Web Store friendly) | `npm run build:package` (cross-platform `cross-env NO_MINIFY=true`) |
| Test | `npm test` |
| Load extension | Chrome → Extensions (`chrome://extensions`) → "Load unpacked" → select `dist/chrome` |
| Reload after changes | `npm run build` then `chrome://extensions` → refresh icon on extension card |
| Debug background SW | Extension card → "Service Worker" link → opens DevTools console |
| Inspect content script | DevTools on any page → Console → select "exampilot-extension" context |

## Architecture

**Data flow:** User clicks extension icon → background injects the content script with `chrome.scripting.executeScript()` → user clicks "全屏"/"区域" → content script checks the active API host permission → if missing, shows an in-page extension iframe permission dialog → content script sends `{action:'captureAndAnalyze'}` or `{action:'captureAndAnalyzeWithRect'}` → background service worker captures screenshot and optionally crops it → sends image as base64 to the configured vision LLM API → returns answer to content script.

```
Content Script                          Background SW
┌─────────────────┐   runtime.sendMessage   ┌─────────────────┐
│ content/index.js │ ─── captureAndAnalyze ─▶│ background/index│
│ content/ui.js    │ ◀── status/sendResponse─│       .js       │
└─────────────────┘                         │ query-ai.js     │
                                            └─────────────────┘
```

**Message flow:**
- Content → background: `chrome.runtime.sendMessage({ action: 'checkApiHostPermission', url })` before saving configs or starting capture
- Content → background: `chrome.runtime.sendMessage({ action: 'captureAndAnalyze' })` for full viewport screenshots
- Content → background: `chrome.runtime.sendMessage({ action: 'captureAndAnalyzeWithRect', rect: {x,y,width,height,dpr} })` for selected regions; background crops via `cropImage()` using OffscreenCanvas + createImageBitmap
- Content → background: `chrome.runtime.sendMessage({ action: 'cancelCapture' })` for explicit cancellation
- Background → content: `chrome.tabs.sendMessage(tabId, { action: 'status', message })` for real-time progress
- Permission iframe → content: `window.parent.postMessage({ source: 'exampilot-permission', granted, origin }, '*')` after optional host permission flow
- Errors: always propagate via `sendResponse({ success: false, error })` for content script UI display

## Key Files

| File | Role |
|------|------|
| `background/index.js` | Service Worker entry. `importScripts()` loads modules. Injects content script on toolbar click, routes capture messages, handles config CRUD, and runs startup initialization (`ensureConfigInitialized`, `ensurePromptInitialized`) |
| `background/request-overrides.js` | Parses advanced Headers/Body JSON overrides and deep-merges them into default requests |
| `background/query-ai.js` | Calls vision LLM API with image URL, returns AI answer. Dispatches to `callChatCompletions()`, `callResponsesAPI()`, `callAnthropicAPI()`, or custom template handling based on `config.apiMode` |
| `background/template-engine.js` | Renders JSON request templates and extracts answer text from custom response templates |
| `content/index.js` | Content script entry (esbuild entry point). Creates host `<div>`, calls `mountPanel()`, handles double-click toggle |
| `content/ui.js` | Preact+htm panel component with Shadow DOM isolation. Functional component with hooks (`useState`, `useEffect`). Config management CRUD, region selection, request preview, prompt editor, UI opacity slider, and in-page API host permission iframe |
| `content/ui-opacity.js` | Normalizes and applies global panel opacity (`uiOpacity`) stored in `chrome.storage.local` |
| `permission/host-permission.html` | Extension page embedded in the current tab as an iframe for optional host permission grants |
| `permission/host-permission.js` | Calls `chrome.permissions.request()` from the iframe button click and reports back via `postMessage` |
| `scripts/build.mjs` | esbuild build script. Cleans `dist/`, bundles content script + background files, copies `manifest.json`, `icons/`, and `permission/` to `dist/chrome/` |
| `content/bundle/content-bundle.js` | esbuild output (IIFE) created under `dist/chrome/`. This is what background injects with `chrome.scripting.executeScript()` |
| `package.json` | Build scripts (`npm run build`, `npm run build:package`) and dependencies (preact, htm, esbuild, cross-env) |
| `manifest.json` | MV3 config. `permissions: ["storage", "activeTab", "scripting"]`; `optional_host_permissions: ["https://*/*"]`; `web_accessible_resources` exposes `permission/*` for the iframe grant page |
| `CLAUDE.md` | Instructions file for Claude Code. Keep in sync when updating AGENTS.md. |

## Key Patterns & Gotchas
- **Programmatic content script injection** — Content script is NOT declared in `manifest.json` via `content_scripts`. It is injected on-demand via `chrome.action.onClicked.addListener` → `chrome.scripting.executeScript`. The panel only appears after the user clicks the extension icon. Double-clicking the page toggles panel visibility; it does not start screenshot capture.
- **CSS isolation via Shadow DOM** — Panel is inside `host.attachShadow({mode:'open'})`. CSS uses `:host` pseudo-class for container + scoped class selectors inside shadow root. The host uses `all: initial` plus explicit base typography to avoid inheriting page styles. All styles in `<style>` tag inside the component template.
- **CSS utility classes** — To reduce repetitive CSS, use the predefined `exmp-*` utility classes in HTML templates: `exmp-flex`, `exmp-flex-col`, `exmp-items-center`, `exmp-justify-between`, `exmp-gap-6`, `exmp-w-full`, `exmp-p-8-14`, `exmp-p-6-14`, `exmp-text-11`, `exmp-text-12`, `exmp-text-13`, `exmp-rounded-8`. Defined at top of the `<style>` block inside the component template. Only write dedicated CSS when a pattern is truly unique — for layout, spacing, and alignment, prefer compositing utility classes.
- **Screenshot panel-hiding** — The panel must be hidden before `captureVisibleTab()`. `sendStatus('截图中...')` must be `await`ed to give the content script time to hide the panel before the screenshot is taken. Other status messages don't need await. The content script auto-reveals the panel on the next non-screenshot status unless the user explicitly hid it.
- **Region selection overlay on `document.body`** — The region selection UI creates a page-level overlay (not inside Shadow DOM) because it must cover the full viewport. It passes CSS pixel coordinates and `devicePixelRatio`; background converts to physical pixels before cropping.
- **`cropImage()` in background** — Uses `fetch()` + `createImageBitmap()` to decode the captured data URL, then `OffscreenCanvas` + `canvas.convertToBlob()` + `FileReader.readAsDataURL()` to re-encode a cropped JPEG (`quality: 0.9`). Coordinates are boundary-clamped.
- **Explicit cancellation** — The content script sends `cancelCapture`; the background aborts `currentAbortController`.
- **Optional API host permissions** — Do not reintroduce `host_permissions: ["<all_urls>"]`. The extension uses `optional_host_permissions: ["https://*/*"]` and checks the configured API URL as `https://hostname/*` before saving configs or starting capture.
- **Permission request user gesture** — `chrome.permissions.request()` must only run in `permission/host-permission.js` from the iframe button click. Do not call it from background service worker message handlers or after async screenshot work, or Chrome will throw `This function must be called during a user gesture`.
- **In-page permission iframe** — Missing API host permission is handled by `content/ui.js` creating `#exmp-permission-overlay` on `document.body` and embedding `permission/host-permission.html?embed=1&origin=...`. The iframe reports success/failure via `window.parent.postMessage`.
- **CORS in MV3 service worker** — `fetch()` from a service worker is still subject to Chrome extension host permissions and CORS behavior. `queryAI()` calls `assertApiHostPermission(config.url)` as a final guard before network calls.
- **`importScripts()`** — MV3 service worker uses `importScripts()` (not ES modules) for loading. Files are concatenated in global scope.
- **`importScripts` function timing** — Functions defined in `background/index.js` after `importScripts()` (e.g., `getActiveConfig`) are available to imported scripts (e.g., `query-ai.js`) at **call time**, not definition time. `queryAI()` calls `getActiveConfig()` at runtime, by which point it exists globally.
- **AI answer HTML rendering** — AI returns limited HTML with `<b>`, `<br>` etc. Sanitize output before rendering with dangerouslySetInnerHTML, because the API endpoint is user-configurable.
- **Error propagation** — All errors (API call failure) propagate back to content script via `sendResponse({success:false, error})` for UI display.
- **Responses API output structure** — `/v1/responses` `output` array can have mixed types (e.g. `reasoning` + `message`). Must find entry with `item.type === 'message'` to read `content[0].text`. Don't assume `output[0]` is the answer.
- **Anthropic Messages API content structure** — `/v1/messages` response `content` array can have mixed types (e.g. `thinking` + `text`). Must find entry with `item.type === 'text'` to read `.text`. Don't assume `content[0]` is the answer.
- **Anthropic image format differs** — Anthropic API expects raw base64 (no `data:image/...` prefix). `callAnthropicAPI()` strips the JPEG prefix and sends `{type: 'image', source: {type: 'base64', media_type: 'image/jpeg', data: <raw>}}`.
- **Advanced request JSON overrides** — Configs store `customHeadersJson` and `customBodyJson` strings, not key/value row arrays. `background/request-overrides.js` parses them as JSON objects and deep-merges them after the default headers/body are built. Objects merge recursively, arrays and primitives replace existing values, and `null` deletes a field. Invalid JSON must surface as a normal `sendResponse({success:false, error})` failure.
- **Custom template API mode** — `apiMode: 'custom-template'` uses `templateHeadersJson`, `templateBodyJson`, and `templateResponseText`. `background/template-engine.js` renders placeholders such as `{{model}}`, `{{apiKey}}`, `{{apiKeyBearer}}`, `{{prompt}}`, `{{imageUrl}}`, `{{imageBase64}}`, `{{base64Image}}`, `{{imageMimeType}}`, and `{{mimeType}}`. Headers must render to a JSON object; body can render to any JSON value; response template extracts the final answer from provider-specific JSON. Exact-placeholder values preserve their original type instead of becoming strings.
- **Request preview in config form** — Config form has an expandable request preview section (`showPreview`) that renders constructed headers/body JSON. In custom-template mode it previews rendered Headers/Body templates and the response template.
- **Config management** — Configs stored in `chrome.storage.local` (survives SW restart). Users add/edit/delete configs via the ⚙️ button in the panel footer. `addConfig` auto-selects the new config (`selected: true`). Deleting the selected config shifts selection to the first remaining. Config list items show whether headers/body JSON overrides or custom template parts are set.
- **Config message actions** — Content↔background CRUD: `getConfigs` (list all), `getConfig` (single by id, auto-defaults `apiMode`, `customHeadersJson`, `customBodyJson`, template fields), `setActiveConfig` (sets `selected: true` on one, false on others), `addConfig` (pushes new item with `selected: true`), `editConfig` (updates name/url/model/apiKey/apiMode/customHeadersJson/customBodyJson/templateHeadersJson/templateBodyJson/templateResponseText), `deleteConfig` (removes, shifts selection if deleted was selected).
- **Config view inline handlers** — Config list is rendered as Preact VDOM, so click handlers use inline Preact event bindings (`onClick=${handler}`) with `stopPropagation()` on edit/delete buttons. No delegation needed.
- **Preact + htm** — `import htm from 'htm'` + `const html = htm.bind(h)` provides tagged-template syntax instead of JSX. No JSX transform needed in esbuild. `useState`, `useEffect` from `'preact/hooks'`.
- **Hooks without destructuring** — Codebase uses `var` (not `const/let`) and avoids destructuring. Hooks pattern: `var _a = useState(initial), value = _a[0], setValue = _a[1]`. Don't use `const [value, setValue] = useState()`.
- **Three panel view states** — `viewState` controls UI: `mini` (collapsed ⚡ button), `main` (answers/status/footer controls), and `config` (settings, config list/form, request preview, UI opacity, prompt editor).
- **UI opacity preference** — `uiOpacity` is stored in `chrome.storage.local`, normalized by `content/ui-opacity.js` to `0.01..1`, applied directly to the Shadow DOM host, and synced via `chrome.storage.onChanged`.
- **Bundle size reference** — `npm run build` currently produces a ~58KB minified content bundle; `npm run build:package` produces a larger unminified bundle for package/debug review. Content script loads this single bundle.
- **No customElements.define** — Chrome content script isolated worlds have `customElements === null`. Panel is a functional component mounted into shadow root, not a custom element. Mounted via Preact's `render()`.
- **Storage migration pattern** — `ensureConfigInitialized()` checks `configList[0].selected === undefined` to detect old-format data and migrates in-place. `ensurePromptInitialized()` follows the same detect-and-initialize pattern for `customPrompt`. Future storage changes should follow the same pattern.
- **Custom prompt storage** — `customPrompt` is a separate string key in `chrome.storage.local` (not in `configList`). Message handlers: `getPrompt` and `setPrompt`.
- **UI loading state catch safety** — Any function that sets a UI-locking state (e.g., `setPromptSaving(true)`) MUST have a `.catch()` that resets the state, or the UI element can get permanently stuck if the Promise rejects.
- **Build output structure** — `scripts/build.mjs` copies `manifest.json`, `icons/`, and `permission/` into `dist/chrome/`, and bundles content/background files. Load `dist/chrome/` in Chrome, not the project root.
- **AbortController request cancellation** — `captureAndAnalyze()` stores a global `currentAbortController`. New captures abort prior in-flight requests; `cancelCapture` aborts the active request. `AbortError` is converted to `'已取消'`.
- **Content script request sequence guard** — `handleStartCapture` increments `currentRequestSeq`; async callbacks discard stale responses from prior requests.
- **`apiFetch` CORS error wrapper** — `apiFetch()` in `query-ai.js` catches `TypeError` from `fetch()` and rethrows a Chinese-language message about CORS / URL correctness.
- **Git remote** — GitHub.
