# ExamPilot

Follow `AGENTS.md` for repository-wide instructions, commands, architecture boundaries, and verification requirements.

Quick reference:

- Install dependencies only at the repository root.
- Keep Chrome extension code in `chrome-extension/` and Tauri desktop code in `desktop-app/`.
- Do not edit generated `dist/` or Rust `target/` files.
- `npm run chrome:build` and `npm run chrome:build:package` each build both Chrome permission variants.
- Treat `exampilot-settings-backup` v1 as a cross-application contract; normalize and test backup fields in both applications.
- `silentCursorOffset` is a 1..20px rightward offset with default 5. It moves the simulated cursor in Chrome and the real cursor in the desktop app.

Use `npm test`, `cargo test --manifest-path desktop-app/src-tauri/Cargo.toml`, and `npm run build` to verify shared settings or silent-mode changes.
