use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose, Engine};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::sidecar;

const WINDOW_SECONDS: usize = 5;
const OVERLAP_SECONDS: usize = 1;
const SILENCE_RMS_THRESHOLD: f32 = 0.003;
const SILENCE_PEAK_THRESHOLD: f32 = 0.015;

#[derive(Default)]
pub struct CaptureState {
    worker: Mutex<Option<CaptureWorker>>,
    last_window: Arc<Mutex<Option<CapturedWindow>>>,
}

struct CaptureWorker {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

#[derive(Clone)]
struct CapturedWindow {
    samples: Vec<f32>,
    sample_rate: u32,
}

#[derive(Clone, Serialize)]
struct AudioWindowEvent {
    sample_rate: u32,
    samples: usize,
    captured_at_ms: u128,
    emitted_at_ms: u128,
    sidecar_sent_at_ms: Option<u128>,
    rms: f32,
    peak: f32,
    silence: bool,
    sidecar_skipped: bool,
    pcm_f32le_base64: String,
    waveform: Vec<f32>,
}

#[derive(Clone, Serialize)]
struct CaptureStatusEvent {
    status: &'static str,
    message: String,
}

#[tauri::command]
pub fn start_capture(
    app: AppHandle,
    state: tauri::State<'_, CaptureState>,
    sidecar_state: tauri::State<'_, sidecar::SidecarState>,
) -> Result<(), String> {
    let mut worker = state.worker.lock().map_err(|_| "capture state poisoned")?;
    if worker.is_some() {
        return Ok(());
    }

    sidecar::start_sidecar(app.clone(), &sidecar_state)?;

    let stop = Arc::new(AtomicBool::new(false));
    let stop_for_thread = Arc::clone(&stop);
    let last_window = Arc::clone(&state.last_window);
    let app_for_thread = app.clone();
    let sidecar_child = Some(sidecar_state.child());

    let join = thread::Builder::new()
        .name("stave-audio-capture".to_string())
        .spawn(move || {
            if let Err(error) = run_capture_loop(
                app_for_thread.clone(),
                stop_for_thread,
                last_window,
                sidecar_child,
            ) {
                let _ = app_for_thread.emit(
                    "capture-status",
                    CaptureStatusEvent {
                        status: "error",
                        message: error,
                    },
                );
            }
        })
        .map_err(|error| error.to_string())?;

    *worker = Some(CaptureWorker {
        stop,
        join: Some(join),
    });

    app.emit(
        "capture-status",
        CaptureStatusEvent {
            status: "listening",
            message: "Capture started".to_string(),
        },
    )
    .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn stop_capture(
    app: AppHandle,
    state: tauri::State<'_, CaptureState>,
    sidecar_state: tauri::State<'_, sidecar::SidecarState>,
) -> Result<(), String> {
    let mut worker = state.worker.lock().map_err(|_| "capture state poisoned")?;
    if let Some(mut worker) = worker.take() {
        worker.stop.store(true, Ordering::Relaxed);
        if let Some(join) = worker.join.take() {
            let _ = join.join();
        }
    }
    sidecar::stop_sidecar(&sidecar_state)?;

    app.emit(
        "capture-status",
        CaptureStatusEvent {
            status: "idle",
            message: "Capture stopped".to_string(),
        },
    )
    .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn dump_debug_wav(state: tauri::State<'_, CaptureState>) -> Result<String, String> {
    let window = state
        .last_window
        .lock()
        .map_err(|_| "capture state poisoned")?
        .clone()
        .ok_or_else(|| "No captured audio window available yet".to_string())?;

    let out_dir = std::env::current_dir()
        .map_err(|error| error.to_string())?
        .join("debug-captures");
    fs::create_dir_all(&out_dir).map_err(|error| error.to_string())?;

    let path = out_dir.join(format!(
        "stave-capture-{}.wav",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_secs()
    ));
    write_wav(&path, &window.samples, window.sample_rate)?;

    Ok(path.display().to_string())
}

fn run_capture_loop(
    app: AppHandle,
    stop: Arc<AtomicBool>,
    last_window: Arc<Mutex<Option<CapturedWindow>>>,
    sidecar_child: Option<Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>>,
) -> Result<(), String> {
    let host = cpal::default_host();
    let device = preferred_capture_device(&host)?;
    let config = device.default_input_config().map_err(|error| {
        format!(
            "Could not open input/loopback stream. On macOS, route audio through a virtual device like BlackHole for now. Details: {error}"
        )
    })?;

    let sample_rate = config.sample_rate().0;
    let channels = config.channels() as usize;
    let window_len = sample_rate as usize * WINDOW_SECONDS;
    let step_len = sample_rate as usize * (WINDOW_SECONDS - OVERLAP_SECONDS);
    let shared_buffer = Arc::new(Mutex::new(Vec::<f32>::with_capacity(window_len * 2)));

    let buffer_for_callback = Arc::clone(&shared_buffer);
    let stream_config = config.config();
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device
            .build_input_stream(
                &stream_config,
                move |data: &[f32], _| push_interleaved(data, channels, &buffer_for_callback),
                stream_error_handler(app.clone()),
                None,
            )
            .map_err(|error| error.to_string())?,
        cpal::SampleFormat::I16 => {
            let buffer_for_callback = Arc::clone(&shared_buffer);
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[i16], _| {
                        let converted: Vec<f32> = data
                            .iter()
                            .map(|sample| *sample as f32 / i16::MAX as f32)
                            .collect();
                        push_interleaved(&converted, channels, &buffer_for_callback);
                    },
                    stream_error_handler(app.clone()),
                    None,
                )
                .map_err(|error| error.to_string())?
        }
        cpal::SampleFormat::U16 => {
            let buffer_for_callback = Arc::clone(&shared_buffer);
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[u16], _| {
                        let converted: Vec<f32> = data
                            .iter()
                            .map(|sample| (*sample as f32 / u16::MAX as f32) * 2.0 - 1.0)
                            .collect();
                        push_interleaved(&converted, channels, &buffer_for_callback);
                    },
                    stream_error_handler(app.clone()),
                    None,
                )
                .map_err(|error| error.to_string())?
        }
        other => return Err(format!("Unsupported sample format: {other:?}")),
    };

    stream.play().map_err(|error| error.to_string())?;

    while !stop.load(Ordering::Relaxed) {
        thread::sleep(std::time::Duration::from_millis(100));
        let maybe_window = {
            let mut buffer = shared_buffer.lock().map_err(|_| "audio buffer poisoned")?;
            if buffer.len() < window_len {
                None
            } else {
                let samples = buffer[..window_len].to_vec();
                let drain_len = step_len.min(buffer.len());
                buffer.drain(..drain_len);
                Some(samples)
            }
        };

        if let Some(samples) = maybe_window {
            emit_window(&app, &last_window, &sidecar_child, samples, sample_rate)?;
        }
    }

    drop(stream);
    Ok(())
}

fn preferred_capture_device(host: &cpal::Host) -> Result<cpal::Device, String> {
    #[cfg(target_os = "windows")]
    if let Some(device) = host.default_output_device() {
        return Ok(device);
    }

    host.default_input_device().ok_or_else(|| {
        "No capture device found. On macOS, install/select BlackHole or another virtual input device for system-audio capture.".to_string()
    })
}

fn stream_error_handler(app: AppHandle) -> impl FnMut(cpal::StreamError) + Send + 'static {
    move |error| {
        let _ = app.emit(
            "capture-status",
            CaptureStatusEvent {
                status: "error",
                message: format!("Audio stream error: {error}"),
            },
        );
    }
}

fn push_interleaved(data: &[f32], channels: usize, buffer: &Arc<Mutex<Vec<f32>>>) {
    if let Ok(mut buffer) = buffer.lock() {
        if channels <= 1 {
            buffer.extend_from_slice(data);
        } else {
            for frame in data.chunks(channels) {
                let sum: f32 = frame.iter().copied().sum();
                buffer.push(sum / frame.len() as f32);
            }
        }
    }
}

fn emit_window(
    app: &AppHandle,
    last_window: &Arc<Mutex<Option<CapturedWindow>>>,
    sidecar_child: &Option<Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>>,
    samples: Vec<f32>,
    sample_rate: u32,
) -> Result<(), String> {
    let captured_at_ms = now_ms()?;
    let waveform = waveform_buckets(&samples, 96);
    let (rms, peak) = audio_level(&samples);
    let silence = rms < SILENCE_RMS_THRESHOLD && peak < SILENCE_PEAK_THRESHOLD;
    let bytes = samples
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect::<Vec<u8>>();

    let mut sidecar_sent_at_ms = None;
    if let Some(child) = sidecar_child {
        if !silence {
            let sent_at = now_ms()?;
            sidecar::write_frame(child, sample_rate, &bytes)?;
            sidecar_sent_at_ms = Some(sent_at);
        }
    }

    if let Ok(mut slot) = last_window.lock() {
        *slot = Some(CapturedWindow {
            samples: samples.clone(),
            sample_rate,
        });
    }

    app.emit(
        "audio-window",
        AudioWindowEvent {
            sample_rate,
            samples: samples.len(),
            captured_at_ms,
            emitted_at_ms: now_ms()?,
            sidecar_sent_at_ms,
            rms,
            peak,
            silence,
            sidecar_skipped: silence,
            pcm_f32le_base64: general_purpose::STANDARD.encode(bytes),
            waveform,
        },
    )
    .map_err(|error| error.to_string())
}

fn now_ms() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())
        .map(|duration| duration.as_millis())
}

fn audio_level(samples: &[f32]) -> (f32, f32) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }

    let mut sum_squares = 0.0_f64;
    let mut peak = 0.0_f32;
    for sample in samples {
        let abs = sample.abs();
        peak = peak.max(abs);
        sum_squares += (*sample as f64) * (*sample as f64);
    }
    let rms = (sum_squares / samples.len() as f64).sqrt() as f32;
    (rms, peak.min(1.0))
}

fn waveform_buckets(samples: &[f32], buckets: usize) -> Vec<f32> {
    if samples.is_empty() || buckets == 0 {
        return Vec::new();
    }

    let bucket_size = (samples.len() / buckets).max(1);
    samples
        .chunks(bucket_size)
        .take(buckets)
        .map(|chunk| {
            let peak = chunk
                .iter()
                .fold(0.0_f32, |max, sample| max.max(sample.abs()));
            peak.min(1.0)
        })
        .collect()
}

fn write_wav(path: &PathBuf, samples: &[f32], sample_rate: u32) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec).map_err(|error| error.to_string())?;
    for sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        writer
            .write_sample((clamped * i16::MAX as f32) as i16)
            .map_err(|error| error.to_string())?;
    }
    writer.finalize().map_err(|error| error.to_string())
}
