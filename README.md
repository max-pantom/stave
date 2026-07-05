# STAVE

STAVE is a Tauri 2 desktop app that listens to audio, streams overlapping PCM windows to a Python sidecar, and renders a live chord ticker.

## Current Status

- React UI: live chord ticker, beat dots, animated waveform, start/stop controls, WAV debug dump, and runtime telemetry.
- Rust capture: `cpal` input capture, mono downmix, 5 second windows, 1 second overlap, waveform buckets, RMS/peak levels, and silence gating before sidecar inference.
- Sidecar bridge: starts the packaged `stave-sidecar`, streams length-prefixed PCM frames, forwards JSON chord segments to the frontend, and reports sidecar status.
- Packaging: Tauri sidecar registration is present. GitHub Actions builds the app instead of running local `tauri build` here.

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

## Audio Setup Notes

Windows is the intended first clean loopback target. macOS system audio still needs ScreenCaptureKit support or a virtual input device such as BlackHole. Today, the app falls back to the default input device on macOS, so you can test the UI, waveform, WAV debug dump, and sidecar bridge with mic or virtual-device audio.

## What Still Needs Real-Device Validation

- Confirm Windows WASAPI loopback captures system audio rather than microphone input.
- Validate the PyInstaller sidecar on a clean machine without Python installed.
- Run known-song accuracy checks through `python3.11 sidecar/infer.py --file test.wav`.
- Measure real end-to-end latency with live audio; the UI now exposes capture and sidecar receive telemetry to make that visible.
