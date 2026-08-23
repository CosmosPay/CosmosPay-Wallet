//! The one error shape every command rejects with.

use crate::models::Failure;
use serde::Serialize;

/// A classified refusal.
///
/// Serialised as an OBJECT, not a string. A Tauri command that rejects with a bare string
/// forces the frontend to parse prose to find out what happened, which is the pattern
/// CLAUDE.md calls a review blocker. Keeping the classification a FIELD means
/// `deviceAuthFailure()` reads `err.failure` and never touches `err.detail`.
///
/// `failure` is what the frontend branches on; `detail` is the platform's own sentence,
/// carried because several distinct native faults share a single classification and the
/// human reading the screen deserves better than "it failed". `src/lib/deviceAuth.ts`
/// shows it only for the unclassified bucket and never matches against it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Error {
    pub failure: Failure,
    pub detail: Option<String>,
}

impl Error {
    pub fn new(failure: Failure) -> Self {
        Self { failure, detail: None }
    }

    pub fn with_detail(failure: Failure, detail: impl Into<String>) -> Self {
        Self { failure, detail: Some(detail.into()) }
    }

    pub fn unsupported() -> Self {
        Self::new(Failure::Unsupported)
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.detail {
            Some(detail) => write!(f, "{:?}: {detail}", self.failure),
            None => write!(f, "{:?}", self.failure),
        }
    }
}

impl std::error::Error for Error {}

/// Recover the classification the Kotlin / Swift side sent.
///
/// Both mobile halves reject with `invoke.reject(detail, failureToken)`, so the token
/// arrives in `code` and the platform's sentence in `message`. Reading the token back is
/// what keeps the classification a CONTRACT rather than prose: without this the frontend
/// would receive `Failed` for a cancelled prompt and paint a red error line over a user
/// who simply tapped "cancel".
///
/// Anything that is not one of our tokens — a crash in the bridge, a serialisation
/// mismatch, a Tauri-level transport failure — is `Failed` with the raw text as detail.
/// Deliberately not guessed at any harder than that: an unrecognised rejection is exactly
/// the case where inventing a friendlier classification would be inventing a fact.
#[cfg(mobile)]
impl From<tauri::plugin::mobile::PluginInvokeError> for Error {
    fn from(err: tauri::plugin::mobile::PluginInvokeError) -> Self {
        use tauri::plugin::mobile::PluginInvokeError;
        let PluginInvokeError::InvokeRejected(response) = &err else {
            return Self::with_detail(Failure::Failed, err.to_string());
        };
        let failure = response
            .code
            .as_deref()
            .and_then(|code| serde_json::from_value::<Failure>(serde_json::Value::String(code.to_string())).ok())
            .unwrap_or(Failure::Failed);
        Self { failure, detail: response.message.clone().filter(|m| !m.trim().is_empty()) }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
