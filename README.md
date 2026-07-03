# STAVE

STAVE is a Tauri 2 desktop app that listens to audio, streams overlapping PCM windows to a Python sidecar, and renders a live chord ticker.

## Development

```sh
pnpm install
pnpm tauri dev
```

The frontend is React + TypeScript. The Rust backend exposes `start_capture`, `stop_capture`, and `dump_debug_wav`.

## Sidecar

The sidecar lives in `sidecar/` and can be tested directly:

```sh
python3.11 sidecar/infer.py --file test.wav
```

For distribution, build the PyInstaller sidecar:

```sh
bash sidecar/build-sidecar.sh
```

The Tauri config registers `src-tauri/binaries/stave-sidecar-{target-triple}` as the bundled sidecar. A local x86_64 macOS development shim is included so `tauri dev` can exercise the same stdin/stdout bridge before the PyInstaller binary is produced.

## Notes

macOS system-audio loopback still needs ScreenCaptureKit support or a virtual input device such as BlackHole. Windows is the intended first clean loopback target.
