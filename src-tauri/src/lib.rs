mod audio_capture;
mod sidecar;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(audio_capture::CaptureState::default())
        .manage(sidecar::SidecarState::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            audio_capture::start_capture,
            audio_capture::stop_capture,
            audio_capture::dump_debug_wav
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
