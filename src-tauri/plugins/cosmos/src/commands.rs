//! The five commands the frontend may name. Every one of them is a thin forward to the
//! platform implementation — no logic lives here, so the desktop and mobile halves cannot
//! drift apart behind a shared "convenience".
//!
//! All five are `async`, and that is load-bearing rather than idiomatic drift: a
//! synchronous Tauri command runs on the main thread, and the Android half raises a
//! `BiometricPrompt` that must be posted TO the main thread from somewhere else. A
//! synchronous command would be waiting on the very thread the prompt needs in order to
//! appear.

use tauri::{AppHandle, Runtime};

use crate::error::Result;
use crate::models::{AuthDeleteRequest, AuthReadRequest, AuthSecret, AuthStatus, AuthStoreRequest, ShareRequest};
use crate::CosmosExt;

#[tauri::command]
pub(crate) async fn auth_status<R: Runtime>(app: AppHandle<R>) -> Result<AuthStatus> {
    app.cosmos().auth_status().await
}

#[tauri::command]
pub(crate) async fn auth_store<R: Runtime>(app: AppHandle<R>, payload: AuthStoreRequest) -> Result<()> {
    app.cosmos().auth_store(payload).await
}

#[tauri::command]
pub(crate) async fn auth_read<R: Runtime>(app: AppHandle<R>, payload: AuthReadRequest) -> Result<AuthSecret> {
    app.cosmos().auth_read(payload).await
}

#[tauri::command]
pub(crate) async fn auth_delete<R: Runtime>(app: AppHandle<R>, payload: AuthDeleteRequest) -> Result<()> {
    app.cosmos().auth_delete(payload).await
}

#[tauri::command]
pub(crate) async fn share_text<R: Runtime>(app: AppHandle<R>, payload: ShareRequest) -> Result<()> {
    app.cosmos().share_text(payload).await
}

#[tauri::command]
pub(crate) async fn app_exit<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.cosmos().app_exit().await
}
