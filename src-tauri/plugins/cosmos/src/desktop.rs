//! The desktop half: there is no secure store here, on purpose.
//!
//! Windows, macOS and Linux have no API that gives what `src/lib/deviceAuth.ts` requires —
//! a key whose every read IS an authenticated operation. Windows Hello and the macOS
//! Keychain can each protect a secret, but through a *check-then-read* shape, and the
//! header on that module explains at length why this wallet refuses that shape: a check
//! that is not the same operation as the read is a check the read can skip.
//!
//! So the answer is `Unsupported`, and the desktop build keeps its password — which works
//! everywhere. This is not a stub waiting to be filled in with the easy version; filling
//! it in with the easy version is the bug.
//!
//! Sharing is absent for a duller reason: no desktop OS offers a share sheet a WebView can
//! raise. `src/lib/share.ts` never calls it there and falls back to the clipboard.

use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::error::{Error, Result};
use crate::models::{
    AuthDeleteRequest, AuthReadRequest, AuthSecret, AuthStatus, AuthStoreRequest, Failure, ShareRequest,
};

pub fn init<R: Runtime, C: serde::de::DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Cosmos<R>> {
    Ok(Cosmos(app.clone()))
}

pub struct Cosmos<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> Cosmos<R> {
    /// `available: false`, with a reason the Settings row can explain. Never an error:
    /// asking what a device can do is a question every build is allowed to ask.
    pub async fn auth_status(&self) -> Result<AuthStatus> {
        Ok(AuthStatus::unavailable(Failure::Unsupported))
    }

    pub async fn auth_store(&self, _payload: AuthStoreRequest) -> Result<()> {
        Err(Error::unsupported())
    }

    pub async fn auth_read(&self, _payload: AuthReadRequest) -> Result<AuthSecret> {
        Err(Error::unsupported())
    }

    /// Succeeds, and does so honestly: there is nothing stored on a desktop, so "forget the
    /// enrolment" is already true. `disableDeviceAuth` calls this on paths that must not
    /// throw, and a refusal here would turn a no-op into a failure to clean up.
    pub async fn auth_delete(&self, _payload: AuthDeleteRequest) -> Result<()> {
        Ok(())
    }

    pub async fn share_text(&self, _payload: ShareRequest) -> Result<()> {
        Err(Error::unsupported())
    }

    /// A desktop window is closed by its own chrome, and the `backPressed` event that
    /// drives this on Android is never emitted here. Refuses rather than calling
    /// `app.exit()`: nothing should be able to close a wallet window from the web layer.
    pub async fn app_exit(&self) -> Result<()> {
        Err(Error::unsupported())
    }
}
