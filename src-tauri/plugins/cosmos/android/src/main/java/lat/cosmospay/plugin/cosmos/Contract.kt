package lat.cosmospay.plugin.cosmos

/**
 * The wire vocabulary, spelled once.
 *
 * Every token here has an exact counterpart in two other files — `Failure` in
 * `src-tauri/plugins/cosmos/src/models.rs` and `DeviceAuthFailure` in
 * `src/lib/deviceAuth.ts` — and the three have to agree letter for letter, because the
 * Rust side parses the token back out of the rejection's `code` field.
 *
 * The strings are therefore a CONTRACT, not prose. Nothing user-facing is decided here:
 * the frontend maps each token to an i18n key, so a token never reaches a screen.
 */
internal enum class Failure(val token: String) {
    UNSUPPORTED("unsupported"),
    NO_HARDWARE("noHardware"),
    NOT_ENROLLED("notEnrolled"),
    NO_PASSCODE("noPasscode"),
    NO_STRONG_BIOMETRY("noStrongBiometry"),
    LOCKED_OUT("lockedOut"),
    LOCKED_OUT_TEMPORARY("lockedOutTemporary"),
    CANCELLED("cancelled"),
    STALE("stale"),
    FAILED("failed"),
}

/**
 * Which modality the device advertises — for wording a button, never for a decision.
 *
 * `GENERIC` covers both "we could not tell" and "there is none", and that conflation is
 * deliberate: the two are the same fact from the button's point of view, and giving them
 * separate tokens would invite code to branch on the difference.
 */
internal object Biometry {
    const val FACE = "face"
    const val FINGERPRINT = "fingerprint"
    const val IRIS = "iris"
    const val MULTIPLE = "multiple"
    const val PASSCODE = "passcode"
    const val GENERIC = "generic"
}

/** What the device can do right now. Mirrors `AuthStatus` in `models.rs`. */
internal data class Status(
    val available: Boolean,
    val biometry: String,
    val reason: Failure?,
)

/** Copy for the OS sheet. Supplied by the caller; this module owns no strings a user reads. */
internal data class Prompt(
    val title: String,
    val reason: String,
    val cancel: String,
)

/**
 * How an asynchronous native operation reports back.
 *
 * `BiometricPrompt` answers on a callback, so nothing here can return a value. Two methods
 * rather than a `Result`, so that a failure is impossible to construct without naming which
 * `Failure` it is — the classification is what the frontend branches on, and a default
 * would make "failed" the silent answer for cases nobody thought about.
 */
internal interface Outcome<T> {
    fun ok(value: T)
    fun fail(failure: Failure, detail: String?)
}
