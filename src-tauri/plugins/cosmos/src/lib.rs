//! Cosmos Pay's own native plugin.
//!
//! Two unrelated capabilities share this crate, and only this crate: a Tauri mobile plugin
//! carries a Gradle module and a Swift package with it, and duplicating that boilerplate to
//! separate two commands buys nothing. They share NO code — separate Rust modules, separate
//! Kotlin classes, separate Swift files, no shared state — because one of them is on the
//! signing path and the other opens a share sheet.
//!
//! - **device auth** (`auth_*`) is the hardware-bound secure store behind
//!   `src/lib/deviceAuth.ts`. Read that module's header first: it is the design, and this
//!   is only its native half.
//! - **share** (`share_text`) raises the OS share sheet on Android and iOS.
//!
//! The platform contracts live beside their implementations: `android/src/main/java/
//! lat/cosmospay/plugin/cosmos/DeviceAuth.kt` and `ios/Sources/CosmosPlugin/DeviceAuth.swift`
//! each open with what their platform guarantees and why.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod commands;
mod error;
mod models;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

#[cfg(desktop)]
use desktop::Cosmos;
#[cfg(mobile)]
use mobile::Cosmos;

pub use error::{Error, Result};
pub use models::{
    AuthDeleteRequest, AuthReadRequest, AuthSecret, AuthStatus, AuthStoreRequest, Biometry, Failure,
    Prompt, ShareRequest,
};

/// Reaches the platform implementation from any `Manager` — `app.cosmos()`.
pub trait CosmosExt<R: Runtime> {
    fn cosmos(&self) -> &Cosmos<R>;
}

impl<R: Runtime, T: Manager<R>> CosmosExt<R> for T {
    fn cosmos(&self) -> &Cosmos<R> {
        self.state::<Cosmos<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("cosmos")
        .invoke_handler(tauri::generate_handler![
            commands::auth_status,
            commands::auth_store,
            commands::auth_read,
            commands::auth_delete,
            commands::share_text,
            commands::app_exit,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let cosmos = mobile::init(app, api)?;
            #[cfg(desktop)]
            let cosmos = desktop::init(app, api)?;
            app.manage(cosmos);
            Ok(())
        })
        .build()
}
