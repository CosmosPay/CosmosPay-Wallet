//! Cosmos Pay — the Tauri host.
//!
//! Desktop and mobile share this entry point: `main.rs` calls `run()` on Windows, macOS
//! and Linux, and `#[tauri::mobile_entry_point]` is what the generated Android and iOS
//! projects call. Nothing platform-specific belongs here — the one capability that
//! differs by OS lives behind `tauri-plugin-cosmos`, which reports itself unavailable
//! where it has no implementation.

/// Build and run the app.
///
/// The plugin list is the app's entire native surface, and it is deliberately short. Every
/// entry is something the web layer cannot do for itself:
///
/// - `os`     — publishes the OS name the frontend reads to tell a phone from a desktop.
///              `src/lib/platform.ts` explains why that answer may not come from a user
///              agent string: it gates the biometric unlock.
/// - `store`  — a durable JSON file for the encrypted vault. See `src/lib/storage.ts` for
///              why WebView local storage is not good enough to hold it.
/// - `clipboard-manager` / `opener` — the two things a WebView either lacks or resolves
///              by navigating itself somewhere else.
/// - `cosmos` — this wallet's own plugin: the hardware-bound secure store behind
///              `src/lib/deviceAuth.ts`, plus the mobile share sheet.
///
/// There is no filesystem, shell, http or process plugin, and none should be added
/// casually: the frontend holds decrypted key material, so every command registered here
/// is something an XSS in the bundle could also call.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_cosmos::init())
        .run(tauri::generate_context!())
        .expect("Cosmos Pay failed to start");
}
