import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Circle, Download, Square, Waves } from "lucide-react";
import "./App.css";

type CaptureStatus = "idle" | "listening" | "error";

type ChordSegment = {
  chord: string;
  start: number;
  end: number;
  beat: boolean;
  sidecar_received_at_ms?: number;
};

type AudioWindowEvent = {
  sample_rate: number;
  samples: number;
  captured_at_ms: number;
  emitted_at_ms: number;
  sidecar_sent_at_ms?: number | null;
  rms: number;
  peak: number;
  silence: boolean;
  sidecar_skipped: boolean;
  waveform: number[];
};

type CaptureStatusEvent = {
  status: CaptureStatus;
  message: string;
};

const fallbackChords: ChordSegment[] = [
  { chord: "C:maj", start: 0, end: 1.1, beat: true },
  { chord: "G:maj", start: 1.1, end: 2.2, beat: true },
  { chord: "A:min", start: 2.2, end: 3.3, beat: true },
  { chord: "F:maj", start: 3.3, end: 4.4, beat: true },
];

type RuntimeMetrics = {
  captureLatencyMs: number | null;
  lastWindowAtMs: number | null;
  peak: number;
  rms: number;
  silence: boolean;
  sidecarLatencyMs: number | null;
  sidecarSkipped: boolean;
};

function App() {
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [message, setMessage] = useState("Ready");
  const [chords, setChords] = useState<ChordSegment[]>(fallbackChords);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [sampleRate, setSampleRate] = useState<number | null>(null);
  const [debugPath, setDebugPath] = useState("");
  const [metrics, setMetrics] = useState<RuntimeMetrics>({
    captureLatencyMs: null,
    lastWindowAtMs: null,
    peak: 0,
    rms: 0,
    silence: false,
    sidecarLatencyMs: null,
    sidecarSkipped: false,
  });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const targetWaveformRef = useRef<number[]>(Array.from({ length: 96 }, () => 0.04));
  const animatedWaveformRef = useRef<number[]>(Array.from({ length: 96 }, () => 0.04));

  useEffect(() => {
    const removers = [
      listen<ChordSegment>("chord-detected", (event) => {
        const receivedAtMs = Date.now();
        setChords((current) => [
          ...current,
          {
            ...event.payload,
            sidecar_received_at_ms: event.payload.sidecar_received_at_ms ?? receivedAtMs,
          },
        ].slice(-20));
        setMetrics((current) => ({
          ...current,
          sidecarLatencyMs: event.payload.sidecar_received_at_ms
            ? Math.max(0, receivedAtMs - event.payload.sidecar_received_at_ms)
            : 0,
        }));
      }),
      listen<AudioWindowEvent>("audio-window", (event) => {
        const receivedAtMs = Date.now();
        setWaveform(event.payload.waveform);
        targetWaveformRef.current = event.payload.waveform;
        setSampleRate(event.payload.sample_rate);
        setMetrics((current) => ({
          ...current,
          captureLatencyMs: Math.max(0, receivedAtMs - event.payload.captured_at_ms),
          lastWindowAtMs: event.payload.emitted_at_ms,
          peak: event.payload.peak,
          rms: event.payload.rms,
          silence: event.payload.silence,
          sidecarSkipped: event.payload.sidecar_skipped,
        }));
      }),
      listen<CaptureStatusEvent>("capture-status", (event) => {
        setStatus(event.payload.status);
        setMessage(event.payload.message);
      }),
      listen<{ status: string; message: string }>("sidecar-status", (event) => {
        setMessage(event.payload.message);
      }),
    ];

    return () => {
      void Promise.all(removers).then((unlistenFns) => {
        unlistenFns.forEach((unlisten) => unlisten());
      });
    };
  }, []);

  useEffect(() => {
    targetWaveformRef.current = waveform.length > 0 ? waveform : targetWaveformRef.current;
  }, [waveform]);

  useEffect(() => {
    let frame = 0;
    let animationId = 0;

    function draw() {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) {
        animationId = requestAnimationFrame(draw);
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width * ratio));
      const height = Math.max(1, Math.floor(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const target = targetWaveformRef.current;
      const current = animatedWaveformRef.current;
      if (current.length !== target.length) {
        animatedWaveformRef.current = target.map(() => 0.04);
      }

      const values = animatedWaveformRef.current.map((value, index) => {
        const idle = status === "listening" ? 0.018 + Math.sin(frame * 0.045 + index * 0.35) * 0.012 : 0.012;
        const next = target[index] ?? idle;
        return value + (Math.max(next, idle) - value) * 0.16;
      });
      animatedWaveformRef.current = values;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#090909";
      ctx.fillRect(0, 0, width, height);

      const grid = ctx.createLinearGradient(0, 0, width, 0);
      grid.addColorStop(0, "rgba(242,166,35,0.04)");
      grid.addColorStop(0.5, "rgba(242,166,35,0.18)");
      grid.addColorStop(1, "rgba(242,166,35,0.04)");
      ctx.strokeStyle = grid;
      ctx.lineWidth = ratio;
      for (let y = 0.25; y < 1; y += 0.25) {
        ctx.beginPath();
        ctx.moveTo(0, height * y);
        ctx.lineTo(width, height * y);
        ctx.stroke();
      }

      const barWidth = width / values.length;
      values.forEach((value, index) => {
        const pulse = 0.84 + Math.sin(frame * 0.06 + index * 0.22) * 0.16;
        const scaled = Math.max(2 * ratio, value * height * 0.88 * pulse);
        const x = index * barWidth;
        const y = (height - scaled) / 2;
        const hot = value > 0.12;
        ctx.fillStyle = hot ? "#ffd17c" : "rgba(242, 166, 35, 0.42)";
        ctx.shadowColor = hot ? "rgba(242, 166, 35, 0.5)" : "transparent";
        ctx.shadowBlur = hot ? 16 * ratio : 0;
        ctx.fillRect(x, y, Math.max(1.5 * ratio, barWidth - 2 * ratio), scaled);
      });
      ctx.shadowBlur = 0;

      const scanX = ((frame * 3.2) % (width + 120 * ratio)) - 120 * ratio;
      const scan = ctx.createLinearGradient(scanX, 0, scanX + 120 * ratio, 0);
      scan.addColorStop(0, "rgba(242,166,35,0)");
      scan.addColorStop(0.5, "rgba(242,166,35,0.22)");
      scan.addColorStop(1, "rgba(242,166,35,0)");
      ctx.fillStyle = scan;
      ctx.fillRect(scanX, 0, 120 * ratio, height);

      frame += 1;
      animationId = requestAnimationFrame(draw);
    }

    animationId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationId);
  }, [status]);

  async function startCapture() {
    setDebugPath("");
    await invoke("start_capture");
  }

  async function stopCapture() {
    await invoke("stop_capture");
  }

  async function dumpDebugWav() {
    const path = await invoke<string>("dump_debug_wav");
    setDebugPath(path);
  }

  const recent = chords.slice(-20);
  const latest = recent[recent.length - 1];
  const levelText = `RMS ${metrics.rms.toFixed(4)} / Peak ${metrics.peak.toFixed(3)}`;

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">STAVE</p>
          <h1>Live chord ticker</h1>
        </div>
        <div className={`status-pill ${status}`}>
          <span />
          {status}
        </div>
      </section>

      <section className="telemetry" aria-label="Runtime telemetry">
        <div>
          <span>capture</span>
          <strong>{metrics.captureLatencyMs === null ? "--" : `${metrics.captureLatencyMs}ms`}</strong>
        </div>
        <div>
          <span>sidecar</span>
          <strong>{metrics.sidecarSkipped ? "silent" : metrics.sidecarLatencyMs === null ? "--" : `${metrics.sidecarLatencyMs}ms`}</strong>
        </div>
        <div>
          <span>level</span>
          <strong>{levelText}</strong>
        </div>
      </section>

      <section className="ticker-panel" aria-label="Chord ticker">
        <div className="now-playing">
          <span>current</span>
          <strong>{latest?.chord ?? "--"}</strong>
        </div>
        <div className="ticker-track">
          {recent.map((segment, index) => {
            const isCurrent = index === recent.length - 1;
            return (
              <div className={`chord-block ${isCurrent ? "current" : ""}`} key={`${segment.chord}-${index}-${segment.start}`}>
                <span>{segment.chord}</span>
                <div className="beat-row">{segment.beat ? <i /> : null}</div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="waveform-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">waveform</p>
            <strong>
              {sampleRate ? `${sampleRate.toLocaleString()} Hz` : "waiting for audio"}
              {metrics.silence ? " / silence gate" : ""}
            </strong>
          </div>
          <Waves aria-hidden="true" size={22} />
        </div>
        <canvas ref={canvasRef} width="1100" height="220" />
      </section>

      <section className="controls">
        <button onClick={startCapture} disabled={status === "listening"} type="button">
          <Circle size={18} aria-hidden="true" />
          Start
        </button>
        <button onClick={stopCapture} disabled={status === "idle"} type="button">
          <Square size={18} aria-hidden="true" />
          Stop
        </button>
        <button onClick={dumpDebugWav} type="button">
          <Download size={18} aria-hidden="true" />
          WAV
        </button>
      </section>

      <footer>
        <span>{message}</span>
        {debugPath ? <code>{debugPath}</code> : null}
      </footer>
    </main>
  );
}

export default App;
