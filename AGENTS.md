# ExamPilot Contributor Guide

ExamPilot contains two independent applications that share Node.js dependencies and a settings-backup format:

- `chrome-extension/`: Chrome Manifest V3 extension.
- `desktop-app/`: Tauri 2 desktop application for Windows x64 and macOS Apple Silicon (not Intel Mac).
- `docs/`: project website and privacy policy.
- `assets/branding/`: source branding assets.

## Repository Rules

- Keep `package.json`, `package-lock.json`, and `node_modules/` at the repository root as the only Node.js installation.
- Do not add application-local npm manifests, lockfiles, or `node_modules` directories.
- Do not edit generated build output in `chrome-extension/dist/`, `desktop-app/dist/`, or Rust `target/` directories.
- Preserve existing user changes in a dirty working tree.
- Use the existing JavaScript style: plain functions and `var` where the surrounding code does so.

## Commands

| Task | Command |
| --- | --- |
| Install dependencies | `npm install` |
| Build both Chrome extension variants and the desktop frontend | `npm run build` |
| Run all Node.js tests | `npm test` |
| Build both Chrome extension variants | `npm run chrome:build` |
| Run extension tests | `npm run chrome:test` |
| Build desktop frontend | `npm run desktop:build` |
| Run desktop frontend tests | `npm run desktop:test` |
| Run the desktop app | `npm run tauri:dev` |
| Build a desktop installer | `npm run tauri:build` |
| Run Rust tests | `cargo test --manifest-path desktop-app/src-tauri/Cargo.toml` |

Both Chrome build commands generate the optional-permission variant in `chrome-extension/dist/chrome/` and the Full Access variant in `chrome-extension/dist/chrome-full/`. Load one of those directories as an unpacked extension, never `chrome-extension/` source directly.

The desktop frontend is built to `desktop-app/dist/`. Tauri configuration and Rust sources are under `desktop-app/src-tauri/`.

## Chrome Extension

- The background service worker captures screenshots and performs AI requests.
- The content script renders the Preact + htm panel inside a Shadow DOM.
- Maintain both Manifest V3 permission variants, request cancellation, custom request templates, settings migration, and the cross-origin iframe cursor bridge.
- Silent mode hides the native page cursor and displays a simulated cursor. Its trigger feedback moves only that simulated cursor.
- Chrome settings live in `chrome.storage.local`; initialize new fields for existing users in `background/index.js` and normalize them in `background/settings-transfer.js`.

## Desktop Application

- The desktop app uses a transparent, always-on-top answer window plus a separate settings window.
- Preserve global shortcuts, native screen capture, region selection, normal and silent modes, Rust HTTP requests, cancellation, native hover targets, and multi-monitor/high-DPI coordinates.
- Silent mode monitors the real system cursor. Its trigger feedback moves the real cursor inside the detected target and leaves it there.
- Frontend settings are stored through `desktop-app/src/desktop-api.mjs`; the native runtime behavior is implemented in `desktop-app/src-tauri/src/lib.rs`.
- The supported release targets are Windows x64 and macOS Apple Silicon only; do not add or document Intel Mac artifacts.

## Desktop Releases and Updates

- Desktop releases are built locally and uploaded manually to the stable GitHub Release; do not restore an automated release workflow unless explicitly requested.
- The Tauri updater endpoint and public key live in `desktop-app/src-tauri/tauri.conf.json`. The private signing key and its password must remain outside the repository.
- A stable release must upload the platform package and its matching `.sig` file, then update `latest.json` with the exact version, URL, and signature for each platform. Use `darwin-aarch64` for macOS Apple Silicon and `windows-x86_64` for Windows x64.
- Keep the release tag, root `package.json`, `desktop-app/src-tauri/Cargo.toml`, and `desktop-app/src-tauri/tauri.conf.json` versions aligned before packaging.
- The updater downloads an update only after user confirmation and restarts the app to install it. Preserve the non-blocking behavior for check, download, and verification failures.

## Shared Settings Backups

The two applications have independent runtime implementations but share the `exampilot-settings-backup` version 1 format. Any change to a backed-up setting must be normalized and tested in both:

- `chrome-extension/background/settings-transfer.js` and its tests.
- `desktop-app/src/shared/settings-transfer.mjs` and its tests.

`silentCursorOffset` is a shared setting for silent trigger feedback. It represents a rightward pixel offset, defaults to `5`, and must be rounded and clamped to `1..20`. In the extension it moves the simulated cursor; in the desktop app it moves the real cursor. Keep that distinction intact.

When a setting affects desktop runtime behavior, pass it through the Tauri command boundary and clamp it again in Rust. Legacy stored settings and legacy backups must continue to receive safe defaults.

## Verification

Run checks proportional to the change. For settings compatibility or silent-mode changes, run at minimum:

```powershell
npm test
cargo test --manifest-path desktop-app/src-tauri/Cargo.toml
npm run build
```
