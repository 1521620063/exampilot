# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

# ExamPilot Extension

Chrome Extension (Manifest V3) that captures viewport screenshots and selected regions, then analyzes them via a user-configured vision LLM API. Images are sent as base64 directly to the API. UI is built with Preact + htm (tagged-template VDOM), bundled via esbuild. Tests use Node's built-in `node --test` runner.

Build output goes to `dist/chrome/`. **Load `dist/chrome/`** (not the project root) as the unpacked extension.

## Commands

| Action | How |
|--------|-----|
| Install dependencies | `npm install` |
| Build default optional-permission version | `npm run build` → `dist/chrome/` |
| Build Full Access version | `npm run build:full` → `dist/chrome-full/` |
| Package build (no minify, Chrome Web Store friendly) | `npm run build:package` (cross-platform `cross-env NO_MINIFY=true`) |
| Test | `npm test` |
| Load extension | Chrome → Extensions (`chrome://extensions`) → "Load unpacked" → select `dist/chrome` |
| Reload after changes | `npm run build` then `chrome://extensions` → refresh icon on extension card |
| Debug background SW | Extension card → "Service Worker" link → opens DevTools console |
| Inspect content script | DevTools on any page → Console → select "exampilot-extension" context |

## Architecture

**Data flow:** In the default build, user clicks extension icon → background injects the content script with `chrome.scripting.executeScript()` → hidden panel is mounted; user double-clicks the page to show it. In the Full Access build, manifest `content_scripts` auto-loads the hidden panel on supported pages → user clicks extension icon or double-clicks the page to show it. Then user clicks "全屏"/"区域" → content script sends `{action:'captureAndAnalyze'}` or `{action:'captureAndAnalyzeWithRect'}` → background service worker captures screenshot and optionally crops it → sends image as base64 to the configured vision LLM API → returns answer to content script.

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
- Content → background: `chrome.runtime.sendMessage({ action: 'injectFrameCursorBridge' })` after a cross-origin iframe host is approved in silent mode; background injects the bridge into permitted frames in the default build
- Content → background: `chrome.runtime.sendMessage({ action: 'captureAndAnalyze' })` for full viewport screenshots
- Content → background: `chrome.runtime.sendMessage({ action: 'captureAndAnalyzeWithRect', rect: {x,y,width,height,dpr} })` for selected regions; background crops via `cropImage()` using OffscreenCanvas + createImageBitmap
- Content → background: `chrome.runtime.sendMessage({ action: 'cancelCapture' })` for explicit cancellation
- Background → content: `chrome.tabs.sendMessage(tabId, { action: 'status', message })` for real-time progress
- Errors: always propagate via `sendResponse({ success: false, error })` for content script UI display

## Key Files

| File | Role |
|------|------|
| `background/index.js` | Service Worker entry. `importScripts()` loads modules. Toggles the auto-injected panel on toolbar click, routes capture messages, handles config CRUD, and runs startup initialization (`ensureConfigInitialized`, `ensurePromptInitialized`) |
| `background/request-overrides.js` | Parses advanced Headers/Body JSON overrides and deep-merges them into default requests |
| `background/query-ai.js` | Calls vision LLM API with image URL, returns AI answer. Dispatches to `callChatCompletions()`, `callResponsesAPI()`, `callAnthropicAPI()`, or custom template handling based on `config.apiMode` |
| `background/template-engine.js` | Renders JSON request templates and extracts answer text from custom response templates |
| `content/index.js` | Content script entry (esbuild entry point). Creates host `<div>`, calls `mountPanel()`, handles double-click toggle |
| `content/frame-cursor.js` | Lightweight all-frame cursor bridge. Hides the native cursor in child frames while silent mode is active, translates nested-frame mouse coordinates, and relays them to the top document via `postMessage` |
| `content/ui.js` | Preact+htm panel component with Shadow DOM isolation. Functional component with hooks (`useState`, `useEffect`). Config management CRUD, region selection, request preview, prompt editor, and UI opacity slider |
| `content/ui-opacity.js` | Normalizes and applies global panel opacity (`uiOpacity`) stored in `chrome.storage.local` |
| `permission/host-permission.html` | Extension page embedded in the current tab as an iframe for optional host permission grants in the default build |
| `permission/host-permission.js` | Calls `chrome.permissions.request()` from the iframe button click and reports back via `postMessage` |
| `scripts/build.mjs` | esbuild build script. Cleans the target dist directory, bundles panel, frame-cursor, and background files, copies assets, and derives the Full Access manifest when `BUILD_MODE=full` |
| `content/bundle/content-bundle.js` | Panel esbuild output (IIFE). Default build injects it programmatically; Full Access build auto-loads it in the top frame via `content_scripts` |
| `content/bundle/frame-cursor-bundle.js` | Frame-cursor esbuild output. Full Access declares it at `document_start` with `all_frames: true`; the default build injects it into permitted frames |
| `package.json` | Build scripts (`npm run build`, `npm run build:package`, `npm run build:full`, `npm run build:full:package`) and dependencies |
| `manifest.json` | Default MV3 config. `permissions: ["storage", "activeTab", "scripting", "clipboardWrite"]`; `optional_host_permissions: ["https://*/*"]`; Full Access manifest is generated into `dist/chrome/manifest.json` |
| `CLAUDE.md` | Instructions file for Claude Code. Keep in sync when updating AGENTS.md. |

## Key Patterns & Gotchas
- **Dual permission builds** — Default build uses `activeTab` + `scripting` and injects a hidden panel on toolbar click; users double-click the page to show it. It additionally requests optional HTTPS host access when silent mode needs to track a cross-origin iframe. Full Access build is selected with `BUILD_MODE=full`; the build script removes `scripting`, adds top-frame panel and all-frame cursor bridge `content_scripts`, and adds `host_permissions: ["<all_urls>"]`. Both builds share the same source via `__EXAMPILOT_FULL_ACCESS__`.
- **Auto-loaded scripts in Full Access** — The frame cursor bridge runs at `document_start` in every frame, while the panel runs at `document_idle` only in the top frame and creates `#exmp-container` with `display: none`. Clicking the extension icon or double-clicking the page toggles visibility; it does not start screenshot capture.
- **Cross-origin iframe cursor bridge** — Parent documents do not receive `mousemove` events from child browsing contexts, and parent `cursor: none` styles do not cross iframe boundaries. `content/frame-cursor.js` hides the child-frame cursor, forwards each mouse point with frame viewport dimensions, and each ancestor translates through its matching `iframe` element until the top document emits `top-move`. `content/ui.js` owns the one visible fake cursor, consumes those translated points, and rechecks permissions when a direct iframe is dynamically added or its `src` changes. Do not mount the Preact panel inside child frames.
- **CSS isolation via Shadow DOM** — Panel is inside `host.attachShadow({mode:'open'})`. CSS uses `:host` pseudo-class for container + scoped class selectors inside shadow root. The host uses `all: initial` plus explicit base typography to avoid inheriting page styles. All styles in `<style>` tag inside the component template.
- **CSS utility classes** — To reduce repetitive CSS, use the predefined `exmp-*` utility classes in HTML templates: `exmp-flex`, `exmp-flex-col`, `exmp-items-center`, `exmp-justify-between`, `exmp-gap-6`, `exmp-w-full`, `exmp-p-8-14`, `exmp-p-6-14`, `exmp-text-11`, `exmp-text-12`, `exmp-text-13`, `exmp-rounded-8`. Defined at top of the `<style>` block inside the component template. Only write dedicated CSS when a pattern is truly unique — for layout, spacing, and alignment, prefer compositing utility classes.
- **Screenshot panel-hiding** — The panel must be hidden before `captureVisibleTab()`. `sendStatus('截图中...')` must be `await`ed to give the content script time to hide the panel before the screenshot is taken. Other status messages don't need await. The content script auto-reveals the panel on the next non-screenshot status unless the user explicitly hid it.
- **Region selection overlay on `document.body`** — The region selection UI creates a page-level overlay (not inside Shadow DOM) because it must cover the full viewport. It passes CSS pixel coordinates and `devicePixelRatio`; background converts to physical pixels before cropping.
- **`cropImage()` in background** — Uses `fetch()` + `createImageBitmap()` to decode the captured data URL, then `OffscreenCanvas` + `canvas.convertToBlob()` + `FileReader.readAsDataURL()` to re-encode a cropped JPEG (`quality: 0.9`). Coordinates are boundary-clamped.
- **Explicit cancellation** — The content script sends `cancelCapture`; the background aborts `currentAbortController`.
- **Optional host permissions** — Default build uses `optional_host_permissions: ["https://*/*"]` and checks the configured API URL before saving configs or starting capture. When silent mode is enabled, `content/ui.js` also inspects direct cross-origin iframe `src` values and reuses the embedded permission page with `purpose=frame`; after approval it sends `injectFrameCursorBridge`. Permission is required because `activeTab` does not grant access to cross-origin child frames.
- **Full Access host permissions** — `host_permissions: ["<all_urls>"]` is generated only for Full Access builds so the panel and frame cursor bridge can auto-load on arbitrary pages and frames, and the service worker can call user-configured API hosts without runtime permission prompts.
- **CORS in MV3 service worker** — `fetch()` from a service worker can still fail because of API CORS/network behavior. `apiFetch()` wraps common `TypeError` failures into a user-facing Chinese error message.
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
- **Build output structure** — Default builds write to `dist/chrome/`; Full Access builds write to `dist/chrome-full/`. Both contain `manifest.json`, `icons/`, `permission/`, `content/bundle/content-bundle.js`, `content/bundle/frame-cursor-bundle.js`, and bundled background files. Load the desired dist directory in Chrome, not the project root. Reloading an extension does not replace already injected page scripts, so refresh the tested page as well.
- **AbortController request cancellation** — `captureAndAnalyze()` stores a global `currentAbortController`. New captures abort prior in-flight requests; `cancelCapture` aborts the active request. `AbortError` is converted to `'已取消'`.
- **Content script request sequence guard** — `handleStartCapture` increments `currentRequestSeq`; async callbacks discard stale responses from prior requests.
- **`apiFetch` CORS error wrapper** — `apiFetch()` in `query-ai.js` catches `TypeError` from `fetch()` and rethrows a Chinese-language message about CORS / URL correctness.
- **Git remote** — GitHub.
