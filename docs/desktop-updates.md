# Desktop updates

The desktop app uses Tauri's signed updater. Stable tags in the form `v1.7.6` trigger `.github/workflows/release.yml`, which builds Windows and macOS artifacts and publishes the updater manifest to GitHub Releases.

The updater public key is configured in `desktop-app/src-tauri/tauri.conf.json`. The matching private key was generated locally at `/Users/chensiyang/.config/exampilot/updater.key`; never commit that file. Copy its full contents into the `TAURI_SIGNING_PRIVATE_KEY` GitHub secret before publishing.

Required GitHub secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (copy the contents of `/Users/chensiyang/.config/exampilot/updater-password`)
- Apple signing/notarization secrets for macOS: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID`

The updater endpoint is the latest stable GitHub Release. The app checks silently at startup and exposes manual checking and download/restart controls in the settings window. Update failures are non-blocking and do not affect existing settings or AI requests.
