package lat.cosmospay.plugin.cosmos

import android.app.Activity
import android.os.Build
import android.os.CancellationSignal
import androidx.core.content.ContextCompat
import androidx.credentials.CreateCredentialResponse
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.CreateCredentialNoCreateOptionException
import androidx.credentials.exceptions.CreateCredentialProviderConfigurationException
import androidx.credentials.exceptions.CreateCredentialUnsupportedException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException
import androidx.credentials.exceptions.GetCredentialUnsupportedException
import androidx.credentials.exceptions.NoCredentialException
import androidx.credentials.exceptions.domerrors.NotAllowedError
import androidx.credentials.exceptions.publickeycredential.CreatePublicKeyCredentialDomException
import androidx.credentials.exceptions.publickeycredential.GetPublicKeyCredentialDomException

/**
 * Passkeys for the mobile app, through Credential Manager.
 *
 * The app's WebView has no WebAuthn of its own, so `src/lib/passkey.ts` hands the ceremony to
 * this file as standard WebAuthn JSON and gets the provider's JSON back. Credential Manager
 * takes that JSON AS IS — `CreatePublicKeyCredentialRequest(requestJson)` — which is why
 * nothing here parses it: the PRF extension (`extensions.prf.eval`) rides through untouched
 * to the provider (Google Password Manager, or whichever the person set), and its answer
 * (`clientExtensionResults.prf.results`) rides back the same way. A schema re-declared in
 * Kotlin would be a third copy to keep in step with the TypeScript and the provider.
 *
 * WHAT MAKES THE PASSKEY THE WEB'S TOO. The request names `rp.id = cosmospay.lat`, and the OS
 * lets this app use a passkey for that domain only because the domain publishes
 * `/.well-known/assetlinks.json` naming this package and its signing certificate
 * (`scripts/passkey-well-known.ts` writes it). Without the file every ceremony fails as a
 * `SecurityError` DOM exception — reported below as `failed` WITH the provider's sentence,
 * because "the app is not associated with the domain" is the one detail that makes it
 * fixable.
 *
 * Nothing here holds a secret. The PRF output passes through on its way to the web layer,
 * which is where `lib/passkeyUnlock.ts` and `lib/cloudBackup.ts` use it; the Keystore work
 * in `DeviceAuth.kt` is unrelated and untouched.
 */
internal object Passkey {

    /**
     * Android 9 (API 28) is the floor for passkeys through Credential Manager; below it there
     * is no provider that can hold one. PRF support is the provider's and cannot be asked in
     * advance, so `available` is only ever "worth trying".
     */
    fun status(): Pair<Boolean, Failure?> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) true to null else false to Failure.UNSUPPORTED

    fun create(activity: Activity, requestJson: String, outcome: Outcome<String>) {
        if (!status().first) return outcome.fail(Failure.UNSUPPORTED, null)
        val manager = CredentialManager.create(activity)
        manager.createCredentialAsync(
            activity,
            CreatePublicKeyCredentialRequest(requestJson),
            CancellationSignal(),
            ContextCompat.getMainExecutor(activity),
            object : CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException> {
                override fun onResult(result: CreateCredentialResponse) {
                    val json = (result as? CreatePublicKeyCredentialResponse)?.registrationResponseJson
                    if (json == null) outcome.fail(Failure.FAILED, "the provider returned no public-key credential")
                    else outcome.ok(json)
                }

                override fun onError(e: CreateCredentialException) = outcome.fail(classify(e), e.message)
            },
        )
    }

    fun get(activity: Activity, requestJson: String, outcome: Outcome<String>) {
        if (!status().first) return outcome.fail(Failure.UNSUPPORTED, null)
        val manager = CredentialManager.create(activity)
        manager.getCredentialAsync(
            activity,
            GetCredentialRequest(listOf(GetPublicKeyCredentialOption(requestJson))),
            CancellationSignal(),
            ContextCompat.getMainExecutor(activity),
            object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
                override fun onResult(result: GetCredentialResponse) {
                    val json = (result.credential as? PublicKeyCredential)?.authenticationResponseJson
                    if (json == null) outcome.fail(Failure.FAILED, "the provider returned no public-key credential")
                    else outcome.ok(json)
                }

                override fun onError(e: GetCredentialException) = outcome.fail(classify(e), e.message)
            },
        )
    }

    /**
     * Into the plugin's `Failure` vocabulary, which `src/lib/passkey.ts` reads back with
     * `nativeFailure`. A dismissal — the sheet closed, or the provider's own "not allowed" —
     * is `CANCELLED` and gets no red line. No provider, or one that cannot do passkeys, is
     * `UNSUPPORTED`, which makes the screen offer a password. No matching passkey on this
     * phone is `STALE`. Everything else is `FAILED` with the provider's sentence.
     */
    private fun classify(e: Throwable): Failure = when (e) {
        is CreateCredentialCancellationException, is GetCredentialCancellationException -> Failure.CANCELLED
        is CreatePublicKeyCredentialDomException -> if (e.domError is NotAllowedError) Failure.CANCELLED else Failure.FAILED
        is GetPublicKeyCredentialDomException -> if (e.domError is NotAllowedError) Failure.CANCELLED else Failure.FAILED
        is CreateCredentialNoCreateOptionException,
        is CreateCredentialProviderConfigurationException,
        is CreateCredentialUnsupportedException,
        is GetCredentialProviderConfigurationException,
        is GetCredentialUnsupportedException -> Failure.UNSUPPORTED
        is NoCredentialException -> Failure.STALE
        else -> Failure.FAILED
    }
}
