//! The wire contract between `src/lib/deviceAuth.ts` and the three implementations.
//!
//! Every enum here serialises to the exact string its TypeScript counterpart branches on,
//! which is the point of owning this plugin rather than adapting someone else's: the
//! Capacitor plugin this replaced spoke in integer error codes that arrived as strings
//! over the bridge, so the frontend classified failures by `Number(err.code)` against a
//! table copied out of a README. A renamed variant here is a compile error in Rust and a
//! `DeviceAuthFailure` that no longer type-checks in TypeScript.

use serde::{Deserialize, Serialize};

/// Why a device check did not work. One variant per user-facing message.
///
/// Mirrors `DeviceAuthFailure` in `src/lib/deviceAuth.ts` one-for-one — camelCase on the
/// wire, so `NoStrongBiometry` is `"noStrongBiometry"` on both sides.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Failure {
    /// No implementation on this platform — a desktop window, or a stale build.
    Unsupported,
    NoHardware,
    NotEnrolled,
    /// No lock screen at all, so there is nothing to bind a key to.
    NoPasscode,
    /// A lock screen, but no Class 3 / biometry-backed authenticator to bind the key to.
    NoStrongBiometry,
    LockedOut,
    LockedOutTemporary,
    /// The user (or the OS) dismissed the prompt. Not an error to shout about.
    Cancelled,
    /// The key is gone: enrolment changed, a restore onto another device, a reinstall.
    Stale,
    Failed,
}

/// What the device offers, for wording the button. Display only, never a decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Biometry {
    Face,
    Fingerprint,
    Iris,
    Multiple,
    /// Lock screen only. Reachable only while unavailable — see `NoStrongBiometry`.
    Passcode,
    Generic,
}

/// The directory to keep out of the device's backups.
///
/// A path, resolved on the Rust side from `app_data_dir()` rather than accepted from the
/// frontend. The web layer holds decrypted key material, so a command that took an
/// arbitrary path would be a command an XSS in the bundle could aim anywhere on the
/// filesystem — and this one is only ever asked about one directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcludeBackupRequest {
    pub path: String,
}

/// What this device can do right now.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    /// The device can bind a key to a live biometric check. The only field driving logic.
    pub available: bool,
    pub biometry: Biometry,
    /// Why not, when `available` is false. `#[serde(default)]` because the mobile
    /// halves omit the field entirely on success rather than sending an explicit null.
    #[serde(default)]
    pub reason: Option<Failure>,
}

impl AuthStatus {
    pub fn unavailable(reason: Failure) -> Self {
        Self { available: false, biometry: Biometry::Generic, reason: Some(reason) }
    }
}

/// Strings for the OS prompt. Supplied by the caller because `lib/` holds no copy of its
/// own and the plugin holds none either — it has no translator and no business having one.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prompt {
    pub title: String,
    pub reason: String,
    pub cancel: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStoreRequest {
    pub key: String,
    /// The wrapping key, already base64. Never the password, and never the seed — see the
    /// header on `src/lib/deviceAuth.ts` for what is sealed under what.
    pub value: String,
    #[serde(flatten)]
    pub prompt: Prompt,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthReadRequest {
    pub key: String,
    #[serde(flatten)]
    pub prompt: Prompt,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthDeleteRequest {
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSecret {
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareRequest {
    pub text: String,
    pub title: Option<String>,
}
