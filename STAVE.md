# STAVE

STAVE is a week-1 MVP for a Tauri desktop app that captures audio, sends overlapping windows to a Python inference sidecar, and renders a live beat-aware chord ticker.

## Architecture

- Tauri 2 shell with a Rust backend and React/TypeScript frontend.
- Rust capture module uses `cpal`, downmixes incoming PCM to mono, buffers 5 second windows, keeps a 1 second overlap, emits `audio-window`, and can dump the last window to WAV for debugging.
- Python sidecar under `sidecar/` reads length-prefixed PCM frames from stdin and writes JSONL chord segments to stdout.
- Rust starts a packaged `src-tauri/binaries/stave-sidecar-*` process when one exists, streams each capture window to stdin, and forwards stdout JSON as `chord-detected`.
- Frontend listens for `audio-window`, `capture-status`, and future `chord-detected` events.

## Current MVP Commands

- `pnpm install`
- `pnpm tauri dev`
- `python3.11 sidecar/infer.py --file test.wav`
- `bash sidecar/build-sidecar.sh`

## Known Week-1 Caveats

- macOS system audio capture still needs ScreenCaptureKit work or a virtual device such as BlackHole. The current Rust path falls back to the default input device on macOS so the UI and WAV debug loop can be tested.
- The sidecar is registered in Tauri and a local development shim is present for `x86_64-apple-darwin`. `madmom` and the PyInstaller binary still need platform validation with real audio.
- Do not run `tauri build` yet; the GitHub workflow for packaging has been written as a commented template.
