package lat.cosmospay.plugin.cosmos

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The Android half of the wallet's secure store.
 *
 * The contract, in one sentence: a value written here can only be read back by an
 * operation that is ITSELF a live Class 3 biometric check. Not "a check, then a read" —
 * the same operation. `src/lib/deviceAuth.ts` explains why the wallet refuses the weaker
 * shape; this file is what makes the stronger one true on Android.
 *
 * How:
 *
 *  - the AES-256/GCM key lives in the AndroidKeyStore, created with
 *    `setUserAuthenticationRequired(true)` and a per-USE authentication policy (a validity
 *    window of zero), so the Keymaster refuses `doFinal` unless the `Cipher` was unlocked
 *    by a `BiometricPrompt` `CryptoObject` moments earlier;
 *  - `setUnlockedDeviceRequired(true)` on API 28+, so it also refuses while the screen is
 *    locked;
 *  - `setInvalidatedByBiometricEnrollment(true)`, so enrolling a new fingerprint destroys
 *    the key rather than granting the new finger access to the old wallet.
 *
 * That last flag is the one the Capacitor plugin this replaced could not offer. Its read
 * path called `getOrCreateCredentialKey(server, 0)` with the invalidation flag hardcoded
 * off and *created* a fresh key when the alias was missing, so a key written with
 * invalidation on could never be read back — `cipher.init` succeeded against a brand-new
 * key and `doFinal` failed the GCM tag. Owning both halves is what makes it usable: the
 * read below never creates anything, and a `KeyPermanentlyInvalidatedException` is
 * reported as `stale`, which is a state the user recovers from in Settings with their
 * password working throughout.
 *
 * Nothing here is ever handed a password or a seed. The value is the 32-byte wrapping key
 * from `src/lib/deviceAuth.ts`, already base64; the password it opens is sealed separately
 * and stored somewhere else entirely.
 */
internal object DeviceAuth {

    private const val KEYSTORE = "AndroidKeyStore"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS = 128
    private const val KEY_BITS = 256

    /** Keystore alias namespace. The caller's key is opaque to us; it is only a suffix. */
    private const val ALIAS_PREFIX = "cosmos.auth."

    /**
     * Where the CIPHERTEXT lives. Not the key — the key never leaves the Keystore, and
     * what lands here decrypts to nothing without it. MODE_PRIVATE, and the app manifest
     * also turns Android Auto Backup off, so this file cannot ride a backup to a device
     * whose Keystore has none of the matching keys.
     */
    private const val PREFS = "cosmos.auth.store"

    /** `iv:ciphertext`, both base64. GCM needs the IV back and it is not a secret. */
    private const val SEPARATOR = ":"

    // ---------------------------------------------------------------- availability

    /**
     * What this device can do right now.
     *
     * Asked of `BIOMETRIC_STRONG` and nothing else: only Class 3 biometry can gate a
     * Keystore `CryptoObject`, so a Class 2 face sensor is not a weaker version of this
     * feature, it is a device that cannot have it. The extra `BIOMETRIC_WEAK` and
     * `DEVICE_CREDENTIAL` queries exist only to tell those two apart in the REASON —
     * "your phone has no biometrics" and "your phone's face unlock is not secure enough"
     * send the user to very different places.
     */
    fun status(context: Context): Status {
        val manager = BiometricManager.from(context)
        val strong = manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
        val kind = biometryKind(context)

        return when (strong) {
            BiometricManager.BIOMETRIC_SUCCESS -> Status(available = true, biometry = kind, reason = null)

            // A Class 3 sensor with nothing enrolled on it. A trip to Settings fixes this,
            // which is what separates it from everything below.
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED ->
                Status(false, kind, Failure.NOT_ENROLLED)

            // Transient: the sensor exists but is busy or disabled by policy right now.
            BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE ->
                Status(false, kind, Failure.NO_HARDWARE)

            // No Class 3 sensor. Which of the three reasons it is depends on what the
            // device DOES have, and the wallet's copy differs for each.
            BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE,
            BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED,
            BiometricManager.BIOMETRIC_STATUS_UNKNOWN,
            BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED -> Status(false, kind, weakerReason(manager, kind))

            else -> Status(false, kind, Failure.FAILED)
        }
    }

    /**
     * Why a device with no Class 3 biometry cannot have the feature.
     *
     * `noPasscode` means there is no lock screen at all — nothing to bind anything to, and
     * the user has to set one before any of this is possible. Everything else is
     * `noStrongBiometry`: a PIN-only phone and a Class 2 face sensor both land here, and
     * both are permanent facts about the hardware rather than settings to go and change.
     */
    private fun weakerReason(manager: BiometricManager, kind: String): Failure {
        val credential = manager.canAuthenticate(BiometricManager.Authenticators.DEVICE_CREDENTIAL)
        if (credential == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED) return Failure.NO_PASSCODE
        // A sensor of some class, or a lock screen: either way there is something, it is
        // just not something a Keystore key can be bound to.
        return if (kind == Biometry.GENERIC && credential != BiometricManager.BIOMETRIC_SUCCESS) {
            Failure.NO_HARDWARE
        } else {
            Failure.NO_STRONG_BIOMETRY
        }
    }

    /**
     * Which modality the device advertises. Display only — it words the button and never
     * decides anything. `BiometricManager` cannot answer this, so it is read off the
     * package manager's hardware features.
     */
    private fun biometryKind(context: Context): String {
        val pm = context.packageManager
        val present = buildList {
            if (pm.hasSystemFeature(PackageManager.FEATURE_FINGERPRINT)) add(Biometry.FINGERPRINT)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                if (pm.hasSystemFeature(PackageManager.FEATURE_FACE)) add(Biometry.FACE)
                if (pm.hasSystemFeature(PackageManager.FEATURE_IRIS)) add(Biometry.IRIS)
            }
        }
        return when {
            present.size > 1 -> Biometry.MULTIPLE
            present.size == 1 -> present[0]
            else -> Biometry.GENERIC
        }
    }

    // ---------------------------------------------------------------------- store

    /**
     * Seal `value` under a fresh hardware key, raising the prompt to do it.
     *
     * DELETE FIRST, ALWAYS. A second enrolment for the same wallet — which is what a
     * password change is — must not reuse the previous alias: the old key is bound to the
     * old enrolment state, and reusing it would leave the new wrapping key readable by
     * whatever could already read the old one. `dropKey` also clears the stored ciphertext,
     * so a refusal below leaves NOTHING rather than a half-enrolment, which is the
     * direction `enableDeviceAuth` in `src/lib/deviceAuth.ts` is written to expect.
     */
    fun store(activity: FragmentActivity, key: String, value: String, prompt: Prompt, done: Outcome<Unit>) {
        dropKey(activity, key)

        val cipher = try {
            val secret = createKey(alias(key))
            Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, secret) }
        } catch (err: Throwable) {
            done.fail(Failure.FAILED, err.message)
            return
        }

        authenticate(activity, prompt, cipher) { result ->
            when (result) {
                is AuthResult.Denied -> done.fail(result.failure, result.detail)
                is AuthResult.Allowed -> try {
                    // The Cipher that comes back is the one the Keymaster unlocked. Using
                    // the captured `cipher` instead would work today and is exactly the
                    // shortcut that turns this into check-then-use, so the result's own
                    // object is the only one touched.
                    val unlocked = result.cipher
                    val sealed = unlocked.doFinal(value.toByteArray(Charsets.UTF_8))
                    prefs(activity).edit()
                        .putString(key, encode(unlocked.iv) + SEPARATOR + encode(sealed))
                        .apply()
                    done.ok(Unit)
                } catch (err: Throwable) {
                    // The prompt succeeded but the Keymaster refused the operation. Leave
                    // nothing behind: a stored blob with no usable key reads as a working
                    // enrolment that fails forever.
                    dropKey(activity, key)
                    done.fail(Failure.FAILED, err.message)
                }
            }
        }
    }

    // ----------------------------------------------------------------------- read

    /**
     * Prompt, and return the value. The prompt IS the read.
     *
     * `cipher.init` for DECRYPT is where a stale enrolment surfaces: the Keymaster throws
     * `KeyPermanentlyInvalidatedException` the moment the biometric set has changed since
     * the key was made. That is reported as `stale` and the remains are dropped, so the
     * wallet stops offering a button that can only ever fail.
     */
    fun read(activity: FragmentActivity, key: String, prompt: Prompt, done: Outcome<String>) {
        val stored = prefs(activity).getString(key, null)
        if (stored == null) {
            done.fail(Failure.STALE, null)
            return
        }
        val parts = stored.split(SEPARATOR)
        if (parts.size != 2) {
            dropKey(activity, key)
            done.fail(Failure.STALE, null)
            return
        }

        val iv = try {
            decode(parts[0])
        } catch (err: Throwable) {
            dropKey(activity, key)
            done.fail(Failure.STALE, null)
            return
        }

        val cipher = try {
            val secret = loadKey(alias(key))
            if (secret == null) {
                // The blob outlived its key: a restore from another device, a reinstall.
                dropKey(activity, key)
                done.fail(Failure.STALE, null)
                return
            }
            Cipher.getInstance(TRANSFORMATION)
                .apply { init(Cipher.DECRYPT_MODE, secret, GCMParameterSpec(GCM_TAG_BITS, iv)) }
        } catch (err: KeyPermanentlyInvalidatedException) {
            dropKey(activity, key)
            done.fail(Failure.STALE, err.message)
            return
        } catch (err: Throwable) {
            done.fail(Failure.FAILED, err.message)
            return
        }

        authenticate(activity, prompt, cipher) { result ->
            when (result) {
                is AuthResult.Denied -> done.fail(result.failure, result.detail)
                is AuthResult.Allowed -> try {
                    done.ok(String(result.cipher.doFinal(decode(parts[1])), Charsets.UTF_8))
                } catch (err: Throwable) {
                    // A GCM tag failure here means the ciphertext and the key no longer
                    // belong together. NOT dropped: a read can also fail transiently, and
                    // wiping a working enrolment over one bad read costs the user their
                    // setup for something a retry fixes. `deviceAuthVaultKey` decides.
                    done.fail(Failure.FAILED, err.message)
                }
            }
        }
    }

    // --------------------------------------------------------------------- delete

    /** Forget both halves. Never throws: every caller is on a cleanup path. */
    fun delete(context: Context, key: String) = dropKey(context, key)

    // ------------------------------------------------------------------ internals

    private fun alias(key: String) = ALIAS_PREFIX + key

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun encode(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun decode(text: String): ByteArray = Base64.decode(text, Base64.NO_WRAP)

    /**
     * Drop the ciphertext first, then the key.
     *
     * That order cannot leave a readable orphan. The reverse can: a process killed between
     * the two would leave a blob whose key is gone, which the read path has to special-case
     * anyway — but the version that survives here should be the one that decrypts to
     * nothing, not the one that might still open.
     */
    private fun dropKey(context: Context, key: String) {
        runCatching { prefs(context).edit().remove(key).apply() }
        runCatching {
            KeyStore.getInstance(KEYSTORE).apply { load(null) }.deleteEntry(alias(key))
        }
    }

    private fun loadKey(alias: String): SecretKey? {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        return store.getKey(alias, null) as? SecretKey
    }

    /**
     * Mint the hardware key.
     *
     * Every flag below is load-bearing; none is a default worth restating for style:
     *
     *  - `setUserAuthenticationRequired(true)` is what makes the key unusable without a
     *    check at all;
     *  - the per-USE policy (a zero validity window) is what makes it unusable without a
     *    check *for this operation*. A non-zero window would let any code that can reach
     *    the decrypt call read the key silently until it expired;
     *  - `setInvalidatedByBiometricEnrollment(true)` is what stops a thief who learns the
     *    device PIN from enrolling their own finger and inheriting the wallet;
     *  - `setUnlockedDeviceRequired(true)` refuses while the screen is locked. API 28+ only,
     *    which is above this module's minSdk, hence the guard.
     */
    private fun createKey(alias: String): SecretKey {
        val builder = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(KEY_BITS)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // 0 seconds = authenticate for EVERY use, through a CryptoObject.
            builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        } else {
            // The pre-API-30 spelling of the same policy. -1 is per-use; any positive
            // value is a time window, which is the thing this must not be.
            @Suppress("DEPRECATION")
            builder.setUserAuthenticationValidityDurationSeconds(-1)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            builder.setUnlockedDeviceRequired(true)
        }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(builder.build())
        return generator.generateKey()
    }

    private sealed interface AuthResult {
        data class Allowed(val cipher: Cipher) : AuthResult
        data class Denied(val failure: Failure, val detail: String?) : AuthResult
    }

    /**
     * Raise the sheet, bound to `cipher`.
     *
     * `BIOMETRIC_STRONG` alone, with an explicit negative button: allowing
     * `DEVICE_CREDENTIAL` here would let the PIN open the sheet, and a PIN cannot unlock a
     * `CryptoObject` — the user would type it, succeed, and meet a crypto error. Android
     * also forbids combining a negative button with device credential, so the two
     * decisions are the same decision.
     *
     * Everything runs on the main thread: `BiometricPrompt` attaches a fragment to the
     * activity, and the Tauri command that got us here is on a worker.
     */
    private fun authenticate(
        activity: FragmentActivity,
        prompt: Prompt,
        cipher: Cipher,
        done: (AuthResult) -> Unit,
    ) {
        activity.runOnUiThread {
            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle(prompt.title)
                .setSubtitle(prompt.reason)
                .setNegativeButtonText(prompt.cancel)
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .setConfirmationRequired(false)
                .build()

            val callback = object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationError(code: Int, message: CharSequence) {
                    done(AuthResult.Denied(failureOf(code), message.toString()))
                }

                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    val unlocked = result.cryptoObject?.cipher
                    if (unlocked == null) {
                        // Should be unreachable: we passed a CryptoObject in. If it ever
                        // happens, the sheet authenticated something OTHER than our key,
                        // and treating that as success is the whole failure mode this
                        // module exists to avoid.
                        done(AuthResult.Denied(Failure.FAILED, "crypto object missing"))
                    } else {
                        done(AuthResult.Allowed(unlocked))
                    }
                }

                // Deliberately empty. A finger the sensor did not recognise leaves the
                // sheet open for another try; rejecting here would close the flow on the
                // user's first smudged touch.
                override fun onAuthenticationFailed() = Unit
            }

            runCatching {
                BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback)
                    .authenticate(info, BiometricPrompt.CryptoObject(cipher))
            }.onFailure { done(AuthResult.Denied(Failure.FAILED, it.message)) }
        }
    }

    /** `BiometricPrompt` error codes, mapped onto the wallet's vocabulary. */
    private fun failureOf(code: Int): Failure = when (code) {
        BiometricPrompt.ERROR_NEGATIVE_BUTTON,
        BiometricPrompt.ERROR_USER_CANCELED,
        BiometricPrompt.ERROR_CANCELED -> Failure.CANCELLED

        // Android's names read backwards from ours: LOCKOUT is the 30-second cool-off,
        // LOCKOUT_PERMANENT is the one only the passcode clears.
        BiometricPrompt.ERROR_LOCKOUT -> Failure.LOCKED_OUT_TEMPORARY
        BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> Failure.LOCKED_OUT

        BiometricPrompt.ERROR_NO_BIOMETRICS -> Failure.NOT_ENROLLED
        BiometricPrompt.ERROR_HW_NOT_PRESENT,
        BiometricPrompt.ERROR_HW_UNAVAILABLE -> Failure.NO_HARDWARE
        BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL -> Failure.NO_PASSCODE
        else -> Failure.FAILED
    }
}
