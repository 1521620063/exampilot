# ExamPilot Desktop

ExamPilot is a Tauri 2 desktop application for screenshot-based AI analysis. The answer HUD stays at the top-left of the screen, including when a browser is in fullscreen mode. Settings are managed in a separate window opened from the system tray.

## Requirements

- Node.js 20 or later
- Rust stable toolchain
- Tauri platform prerequisites for Windows or macOS

## Development

```powershell
npm --prefix desktop install
npm run tauri:dev
```

The frontend-only build is available through `npm run build`; create an installer with `npm run tauri:build`.

## Usage

Use the tray menu to open Settings and configure an AI provider. The app supports OpenAI-compatible Chat Completions, Responses API, Anthropic Messages, and custom JSON templates. Existing `exampilot-settings-backup` v1 JSON files can be imported from Settings.

- `Ctrl+Shift+1`: capture the monitor under the pointer and analyze it
- `Ctrl+Shift+2`: select a screen region and analyze it
- `Ctrl+Shift+3`: switch to the next AI configuration
- `Ctrl+Shift+4`: cancel the active request or clear the result

Normal mode shows the full answer in the HUD. In silent mode, coordinate-based answers create transparent hover targets; answers without coordinates are copied to the clipboard.

On macOS, grant Screen Recording permission for capture and Accessibility permission for mouse feedback when prompted.

## Tests

```powershell
npm test
Set-Location desktop/src-tauri
cargo test
```
