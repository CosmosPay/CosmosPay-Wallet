import Foundation

/// The wire vocabulary, spelled once.
///
/// Every token here has an exact counterpart in two other files — `Failure` in
/// `src-tauri/plugins/cosmos/src/models.rs` and `DeviceAuthFailure` in
/// `src/lib/deviceAuth.ts` — and the three have to agree letter for letter, because the
/// Rust side parses the token back out of the rejection's `code` field.
///
/// The strings are a CONTRACT, not prose. Nothing user-facing is decided here: the
/// frontend maps each token to an i18n key, so a token never reaches a screen.
enum Failure: String {
    case unsupported
    case noHardware
    case notEnrolled
    case noPasscode
    case noStrongBiometry
    case lockedOut
    case lockedOutTemporary
    case cancelled
    case stale
    case failed
}

/// Which modality the device advertises — for wording a button, never for a decision.
///
/// `generic` covers both "we could not tell" and "there is none", and that conflation is
/// deliberate: the two are the same fact from the button's point of view, and giving them
/// separate tokens would invite code to branch on the difference.
enum Biometry: String {
    case face
    case fingerprint
    case iris
    case multiple
    case passcode
    case generic
}

/// What the device can do right now. Mirrors `AuthStatus` in `models.rs`.
struct Status {
    let available: Bool
    let biometry: Biometry
    let reason: Failure?
}

/// Copy for the OS sheet. Supplied by the caller; this module owns no strings a user reads.
struct Prompt {
    let title: String
    let reason: String
    let cancel: String
}

/// A classified refusal, thrown across the Swift half.
///
/// Carries the platform's own sentence as `detail` because several distinct Security
/// framework faults share one classification, and the human reading the screen deserves
/// better than "it failed". The frontend shows it only for the unclassified bucket.
struct DeviceAuthError: Error {
    let failure: Failure
    let detail: String?

    init(_ failure: Failure, _ detail: String? = nil) {
        self.failure = failure
        self.detail = detail
    }
}
