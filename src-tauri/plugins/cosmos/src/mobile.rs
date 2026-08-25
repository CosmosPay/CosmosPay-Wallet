//! The mobile half: a forward to the Kotlin and Swift implementations.
//!
//! Nothing is decided here. Both platforms classify their own failures — they are the only
//! side that can, since the distinction between "no sensor", "no enrolled finger" and "the
//! key was invalidated by a new enrolment" exists only in the platform APIs — and reject
//! with a `Failure` token in `code`. `error.rs` reads it back.

use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::error::Result;
use crate::models::{
    AuthDeleteRequest, AuthReadRequest, AuthSecret, AuthStatus, AuthStoreRequest, ShareRequest,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_cosmos);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<Cosmos<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("lat.cosmospay.plugin.cosmos", "CosmosPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_cosmos)?;
    Ok(Cosmos(handle))
}

pub struct Cosmos<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Cosmos<R> {
    pub async fn auth_status(&self) -> Result<AuthStatus> {
        self.0.run_mobile_plugin("authStatus", ()).map_err(Into::into)
    }

    pub async fn auth_store(&self, payload: AuthStoreRequest) -> Result<()> {
        self.0.run_mobile_plugin("authStore", payload).map_err(Into::into)
    }

    pub async fn auth_read(&self, payload: AuthReadRequest) -> Result<AuthSecret> {
        self.0.run_mobile_plugin("authRead", payload).map_err(Into::into)
    }

    pub async fn auth_delete(&self, payload: AuthDeleteRequest) -> Result<()> {
        self.0.run_mobile_plugin("authDelete", payload).map_err(Into::into)
    }

    pub async fn share_text(&self, payload: ShareRequest) -> Result<()> {
        self.0.run_mobile_plugin("shareText", payload).map_err(Into::into)
    }

    pub async fn app_exit(&self) -> Result<()> {
        self.0.run_mobile_plugin("appExit", ()).map_err(Into::into)
    }
}
