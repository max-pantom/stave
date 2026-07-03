#!/usr/bin/env python3
"""STAVE chord and beat inference sidecar.

Streaming frame format:
  - 4 bytes little-endian unsigned payload length
  - payload bytes: 4 bytes little-endian unsigned sample rate, then float32 PCM mono

The script writes one compact JSON object per detected chord segment to stdout.
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np


@dataclass
class Segment:
    chord: str
    start: float
    end: float
    beat: bool


def load_madmom_processors():
    try:
        from madmom.features.beats import DBNBeatTrackingProcessor, RNNBeatProcessor
        from madmom.features.chords import CNNChordFeatureProcessor, CRFChordRecognitionProcessor
    except Exception as exc:  # pragma: no cover - depends on local native deps
        raise RuntimeError(
            "madmom could not be imported. Install sidecar dependencies with "
            "`python3.11 -m pip install -r sidecar/requirements.txt`."
        ) from exc

    return {
        "chord_features": CNNChordFeatureProcessor(),
        "chords": CRFChordRecognitionProcessor(),
        "beat_features": RNNBeatProcessor(),
        "beats": DBNBeatTrackingProcessor(fps=100),
    }


def read_wave(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as wav:
        sample_rate = wav.getframerate()
        channels = wav.getnchannels()
        sample_width = wav.getsampwidth()
        frames = wav.readframes(wav.getnframes())

    if sample_width == 2:
        audio = np.frombuffer(frames, dtype="<i2").astype(np.float32) / np.iinfo(np.int16).max
    elif sample_width == 4:
        audio = np.frombuffer(frames, dtype="<i4").astype(np.float32) / np.iinfo(np.int32).max
    else:
        raise ValueError(f"Unsupported WAV sample width: {sample_width}")

    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    return audio.astype(np.float32, copy=False), sample_rate


def infer_segments(source: Path, processors: dict, offset: float = 0.0) -> list[Segment]:
    chord_features = processors["chord_features"](str(source))
    raw_chords = processors["chords"](chord_features)
    beat_activations = processors["beat_features"](str(source))
    beats = processors["beats"](beat_activations)

    segments: list[Segment] = []
    for row in raw_chords:
        start, end, chord = float(row[0]), float(row[1]), str(row[2])
        snapped_start = snap_to_beat(start, beats)
        snapped_end = snap_to_beat(end, beats)
        segments.append(
            Segment(
                chord=chord,
                start=snapped_start + offset,
                end=max(snapped_end, snapped_start) + offset,
                beat=has_nearby_beat(snapped_start, beats),
            )
        )
    return dedupe_segments(segments)


def snap_to_beat(value: float, beats: Iterable[float], tolerance: float = 0.18) -> float:
    beat_array = np.asarray(list(beats), dtype=np.float32)
    if beat_array.size == 0:
        return value
    nearest = float(beat_array[np.argmin(np.abs(beat_array - value))])
    return nearest if abs(nearest - value) <= tolerance else value


def has_nearby_beat(value: float, beats: Iterable[float], tolerance: float = 0.08) -> bool:
    return any(abs(float(beat) - value) <= tolerance for beat in beats)


def dedupe_segments(segments: Iterable[Segment]) -> list[Segment]:
    deduped: list[Segment] = []
    for segment in segments:
        if deduped and deduped[-1].chord == segment.chord and abs(deduped[-1].end - segment.start) < 0.2:
            deduped[-1].end = max(deduped[-1].end, segment.end)
            deduped[-1].beat = deduped[-1].beat or segment.beat
        else:
            deduped.append(segment)
    return deduped


def write_segments(segments: Iterable[Segment]) -> None:
    for segment in segments:
        print(
            json.dumps(
                {
                    "chord": segment.chord,
                    "start": round(segment.start, 3),
                    "end": round(segment.end, 3),
                    "beat": segment.beat,
                },
                separators=(",", ":"),
            ),
            flush=True,
        )


def write_temp_wave(audio: np.ndarray, sample_rate: int) -> Path:
    tmp = tempfile.NamedTemporaryFile(prefix="stave-window-", suffix=".wav", delete=False)
    tmp.close()
    path = Path(tmp.name)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        pcm = np.clip(audio, -1.0, 1.0)
        wav.writeframes((pcm * np.iinfo(np.int16).max).astype("<i2").tobytes())
    return path


def read_stream_frames() -> Iterable[tuple[np.ndarray, int]]:
    stdin = sys.stdin.buffer
    while True:
        header = stdin.read(4)
        if not header:
            return
        if len(header) != 4:
            raise EOFError("Truncated frame length header")
        (payload_len,) = struct.unpack("<I", header)
        payload = stdin.read(payload_len)
        if len(payload) != payload_len:
            raise EOFError("Truncated audio payload")
        if payload_len < 4:
            raise ValueError("Audio payload is too short")

        (sample_rate,) = struct.unpack("<I", payload[:4])
        audio = np.frombuffer(payload[4:], dtype="<f4").astype(np.float32, copy=False)
        yield audio, sample_rate


def run_stream() -> int:
    processors = load_madmom_processors()
    last_end = 0.0
    chunk_offset = 0.0
    hop_seconds = 4.0

    for audio, sample_rate in read_stream_frames():
        temp_path = write_temp_wave(audio, sample_rate)
        segments = []
        try:
            for segment in infer_segments(temp_path, processors, offset=chunk_offset):
                if segment.end <= last_end - 0.05:
                    continue
                segment.start = max(segment.start, last_end)
                segments.append(segment)
                last_end = max(last_end, segment.end)
            write_segments(segments)
        finally:
            temp_path.unlink(missing_ok=True)
        chunk_offset += hop_seconds
    return 0


def run_file(path: Path) -> int:
    processors = load_madmom_processors()
    write_segments(infer_segments(path, processors))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="STAVE chord and beat inference sidecar")
    parser.add_argument("--file", type=Path, help="Run inference against a WAV file and print JSONL")
    args = parser.parse_args()

    try:
        if args.file:
            return run_file(args.file)
        return run_stream()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
