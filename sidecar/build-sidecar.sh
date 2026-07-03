#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_TRIPLE="$(rustc -vV | awk '/host:/ { print $2 }')"
OUT_DIR="$ROOT_DIR/src-tauri/binaries"

mkdir -p "$OUT_DIR"
python3.11 -m pip install -r "$ROOT_DIR/sidecar/requirements.txt"
python3.11 -m PyInstaller \
  --onefile \
  --name "stave-sidecar-$TARGET_TRIPLE" \
  --distpath "$OUT_DIR" \
  --workpath "$ROOT_DIR/sidecar/.pyinstaller-build" \
  --specpath "$ROOT_DIR/sidecar/.pyinstaller-spec" \
  "$ROOT_DIR/sidecar/infer.py"
