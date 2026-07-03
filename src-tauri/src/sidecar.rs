use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

#[derive(Default)]
pub struct SidecarState {
    child: Arc<Mutex<Option<CommandChild>>>,
}

#[derive(Clone, Serialize)]
struct SidecarStatusEvent {
    status: &'static str,
    message: String,
}

impl SidecarState {
    pub fn child(&self) -> Arc<Mutex<Option<CommandChild>>> {
        Arc::clone(&self.child)
    }
}

pub fn start_sidecar<R: Runtime>(app: AppHandle<R>, state: &SidecarState) -> Result<(), String> {
    let mut child_slot = state.child.lock().map_err(|_| "sidecar state poisoned")?;
    if child_slot.is_some() {
        return Ok(());
    }

    let command = app
        .shell()
        .sidecar("binaries/stave-sidecar")
        .map_err(|error| format!("Sidecar binary is not available yet: {error}"))?;
    let (mut rx, child) = command
        .spawn()
        .map_err(|error| format!("Could not start sidecar: {error}"))?;

    let app_for_events = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&line) {
                        let _ = app_for_events.emit("chord-detected", value);
                    }
                }
                CommandEvent::Stderr(line) => {
                    let message = String::from_utf8_lossy(&line).trim().to_string();
                    if !message.is_empty() {
                        let _ = app_for_events.emit(
                            "sidecar-status",
                            SidecarStatusEvent {
                                status: "error",
                                message,
                            },
                        );
                    }
                }
                CommandEvent::Error(message) => {
                    let _ = app_for_events.emit(
                        "sidecar-status",
                        SidecarStatusEvent {
                            status: "error",
                            message,
                        },
                    );
                }
                CommandEvent::Terminated(payload) => {
                    let _ = app_for_events.emit(
                        "sidecar-status",
                        SidecarStatusEvent {
                            status: "stopped",
                            message: format!("Sidecar exited with code {:?}", payload.code),
                        },
                    );
                    break;
                }
                _ => {}
            }
        }
    });

    *child_slot = Some(child);
    app.emit(
        "sidecar-status",
        SidecarStatusEvent {
            status: "running",
            message: "Sidecar running".to_string(),
        },
    )
    .map_err(|error| error.to_string())?;

    Ok(())
}

pub fn stop_sidecar(state: &SidecarState) -> Result<(), String> {
    let mut child_slot = state.child.lock().map_err(|_| "sidecar state poisoned")?;
    if let Some(child) = child_slot.take() {
        let _ = child.kill();
    }
    Ok(())
}

pub fn write_frame(
    child: &Arc<Mutex<Option<CommandChild>>>,
    sample_rate: u32,
    pcm_f32le: &[u8],
) -> Result<(), String> {
    let mut guard = child.lock().map_err(|_| "sidecar state poisoned")?;
    let Some(child) = guard.as_mut() else {
        return Ok(());
    };

    let payload_len = 4 + pcm_f32le.len();
    child
        .write(&payload_len.to_le_bytes())
        .and_then(|_| child.write(&sample_rate.to_le_bytes()))
        .and_then(|_| child.write(pcm_f32le))
        .map_err(|error| error.to_string())
}
