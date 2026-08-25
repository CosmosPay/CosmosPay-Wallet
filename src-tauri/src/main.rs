// A release build must not open a console window behind the app on Windows. Only the
// release build: `tauri dev` prints to that console, and losing it would take every
// `println!` and every Rust panic message with it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    cosmos_wallet_lib::run()
}
