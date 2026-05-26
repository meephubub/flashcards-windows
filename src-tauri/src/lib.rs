fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build()) // <--- Add this
        .plugin(tauri_plugin_process::init()) // <--- Add this
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
