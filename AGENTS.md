# ExamPilot Desktop

This repository contains only the Tauri 2 desktop application in `desktop/`.

## Commands

| Action | Command |
| --- | --- |
| Install frontend dependencies | `npm --prefix desktop install` |
| Frontend build | `npm run build` |
| Frontend tests | `npm test` |
| Run desktop app | `npm run tauri:dev` |
| Build desktop installer | `npm run tauri:build` |
| Rust tests | `cd desktop/src-tauri; cargo test` |

## Structure

- `desktop/src/`: Preact renderer, including the answer HUD, settings window, and region-selection overlay.
- `desktop/src/shared/`: AI request templates, request overrides, and settings backup compatibility logic.
- `desktop/src-tauri/`: Rust backend for capture, global shortcuts, windows, HTTP requests, clipboard, and mouse feedback.
- `desktop/test/`: Node tests for renderer-side logic.

The answer HUD must remain transparent, always on top, and fixed to the screen's upper-left. Keep settings in the separate settings window. Do not add browser extension manifests, content scripts, or browser-specific build tooling back to this repository.
