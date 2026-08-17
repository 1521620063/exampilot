# ExamPilot

This repository contains two ExamPilot applications with shared Node.js dependencies at the repository root:

- `chrome-extension/`: Chrome Manifest V3 extension.
- `desktop-app/`: Tauri 2 desktop application for Windows and macOS.
- `docs/`: shared project website and privacy policy.
- `assets/branding/`: shared high-resolution brand source assets.

Keep the root `package.json`, `package-lock.json`, and `node_modules/` as the single Node.js dependency installation. Do not add app-local npm manifests or `node_modules` directories.

## Commands

| Action | Command |
| --- | --- |
| Install all Node.js dependencies | `npm install` |
| Build both applications | `npm run build` |
| Test both applications | `npm test` |
| Build Chrome extension | `npm run chrome:build` |
| Build Chrome Full Access extension | `npm run chrome:build:full` |
| Run desktop application | `npm run tauri:dev` |
| Build desktop installer | `npm run tauri:build` |
| Test Rust backend | `cargo test --manifest-path desktop-app/src-tauri/Cargo.toml` |

Chrome build output goes to `chrome-extension/dist/chrome/` or `chrome-extension/dist/chrome-full/`. Load one of those directories as the unpacked extension, not the source directory.

The desktop frontend build goes to `desktop-app/dist/`. Tauri configuration and Rust sources live in `desktop-app/src-tauri/`.

## Chrome Extension

The extension captures screenshots in the background service worker and renders its Preact + htm panel from the content script. Preserve its Manifest V3 permission variants, Shadow DOM isolation, request cancellation, custom API templates, settings migration, and cross-origin iframe cursor bridge.

## Desktop Application

The Tauri application uses a transparent always-on-top answer window and a separate settings window. Preserve global shortcuts, native screen capture, region selection, normal/silent modes, HTTP requests through Rust, native hover targets, cancellation, and multi-monitor/high-DPI coordinate handling.

The two applications may share dependency versions and data formats, but their runtime implementations remain independent. Changes to settings backup compatibility should be tested in both applications.
