package lat.cosmospay.plugin.cosmos

import android.app.Activity
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.fragment.app.FragmentActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * Argument shapes.
 *
 * Flat rather than nested, because `Prompt` is `#[serde(flatten)]`-ed into the request
 * structs on the Rust side — see `src-tauri/plugins/cosmos/src/models.rs`. `lateinit` on
 * every required field is what turns a malformed payload into a crash in the bridge rather
 * than a silent empty string reaching the Keystore.
 */
@InvokeArg
internal class AuthStoreArgs {
    lateinit var key: String
    lateinit var value: String
    lateinit var title: String
    lateinit var reason: String
    lateinit var cancel: String
}

@InvokeArg
internal class AuthReadArgs {
    lateinit var key: String
    lateinit var title: String
    lateinit var reason: String
    lateinit var cancel: String
}

@InvokeArg
internal class AuthDeleteArgs {
    lateinit var key: String
}

@InvokeArg
internal class ShareArgs {
    lateinit var text: String
    var title: String? = null
}

/**
 * The bridge. Parses arguments, forwards, and turns the answer back into an `Invoke`
 * resolution — no logic of its own, which is what keeps the two capabilities behind it
 * from growing shared behaviour.
 *
 * Every rejection carries its `Failure` token as the `code`, because that is the field
 * `src-tauri/plugins/cosmos/src/error.rs` reads the classification back out of. Rejecting
 * with a message alone would reach the frontend as an unclassified `failed`, which paints
 * a red error line over a user who simply tapped "cancel".
 */
@TauriPlugin
class CosmosPlugin(private val activity: Activity) : Plugin(activity) {

    companion object {
        /**
         * The DOM event dispatched on `window` when the hardware back button is pressed.
         *
         * Listened for by `src/app/WalletApp.tsx` through `nativeListen`, and namespaced
         * because `window` is a shared bus. Tauri's own `trigger()` / `addPluginListener`
         * pair is deliberately NOT used: `addPluginListener` invokes
         * `plugin:cosmos|register_listener`, which Tauri implements in this base class but
         * does not forward to from Rust, so a custom plugin would have to hold the
         * `Channel` and route it itself — real plumbing on the signing path's own crate,
         * for one zero-argument notification.
         */
        const val BACK_PRESSED = "cosmos:backPressed"
    }

    /** Held from `load` so the back callback can reach the page. */
    private var webView: WebView? = null

    /**
     * The activity the biometric sheet attaches to.
     *
     * `BiometricPrompt` needs a `FragmentActivity` — it hosts itself in a fragment. Tauri's
     * own activity is one, so this cast holds; it is checked rather than forced because the
     * failure mode of `as` here would be a crash on the user's unlock screen, and
     * `unsupported` is a state the wallet already knows how to present.
     */
    private val host: FragmentActivity?
        get() = activity as? FragmentActivity

    /**
     * Take over the hardware back button.
     *
     * The wallet owns a navigation stack (`src/lib/screens.ts`) that the WebView knows
     * nothing about, so the default behaviour — finish the activity — closes the app from
     * whatever screen the user is on. Every press is forwarded to the web layer instead,
     * which pops its own stack and calls `app_exit` when there is nowhere left to go.
     *
     * `OnBackPressedDispatcher` rather than an override in `MainActivity`: that file lives
     * under `src-tauri/gen/android/`, which `tauri android init` regenerates, so anything
     * written into it is one re-init away from silently disappearing. A callback registered
     * from here travels with the plugin.
     */
    override fun load(webView: WebView) {
        super.load(webView)
        this.webView = webView
        val host = this.host ?: return
        host.onBackPressedDispatcher.addCallback(
            host,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    // Already on the UI thread — `OnBackPressedDispatcher` dispatches there,
                    // and that is the only thread `evaluateJavascript` may be called from.
                    this@CosmosPlugin.webView?.evaluateJavascript(
                        "window.dispatchEvent(new Event('$BACK_PRESSED'))",
                        null,
                    )
                }
            },
        )
    }

    @Command
    fun authStatus(invoke: Invoke) {
        val context = host
        if (context == null) {
            // Reported as a STATUS rather than a rejection: "what can this device do" is a
            // question every build may ask, and "nothing" is a valid answer to it.
            invoke.resolve(statusObject(Status(false, Biometry.GENERIC, Failure.UNSUPPORTED)))
            return
        }
        invoke.resolve(statusObject(DeviceAuth.status(context)))
    }

    @Command
    fun authStore(invoke: Invoke) {
        val args = invoke.parseArgs(AuthStoreArgs::class.java)
        val context = host ?: return invoke.rejectWith(Failure.UNSUPPORTED, null)
        DeviceAuth.store(
            context,
            args.key,
            args.value,
            Prompt(args.title, args.reason, args.cancel),
            object : Outcome<Unit> {
                override fun ok(value: Unit) = invoke.resolve()
                override fun fail(failure: Failure, detail: String?) = invoke.rejectWith(failure, detail)
            },
        )
    }

    @Command
    fun authRead(invoke: Invoke) {
        val args = invoke.parseArgs(AuthReadArgs::class.java)
        val context = host ?: return invoke.rejectWith(Failure.UNSUPPORTED, null)
        DeviceAuth.read(
            context,
            args.key,
            Prompt(args.title, args.reason, args.cancel),
            object : Outcome<String> {
                override fun ok(value: String) = invoke.resolve(JSObject().put("value", value))
                override fun fail(failure: Failure, detail: String?) = invoke.rejectWith(failure, detail)
            },
        )
    }

    @Command
    fun authDelete(invoke: Invoke) {
        val args = invoke.parseArgs(AuthDeleteArgs::class.java)
        // Resolves even with no activity to speak of: every caller is on a cleanup path and
        // "there was nothing to delete" is success. See `desktop.rs` for the same choice.
        DeviceAuth.delete(activity, args.key)
        invoke.resolve()
    }

    @Command
    fun shareText(invoke: Invoke) {
        val args = invoke.parseArgs(ShareArgs::class.java)
        try {
            ShareSheet.share(activity, args.text, args.title)
            invoke.resolve()
        } catch (err: Throwable) {
            // No sheet appeared. `FAILED` rather than `CANCELLED`, and the difference is
            // what makes `src/lib/share.ts` fall back to the clipboard instead of assuming
            // the user declined.
            invoke.rejectWith(Failure.FAILED, err.message)
        }
    }

    /**
     * Close the app, for the one case the web layer cannot handle: back pressed with an
     * empty navigation stack.
     *
     * `finish()` rather than `exitProcess`: it lets Android tear the activity down the way
     * it does for every other app, so the task is left in a state the launcher can resume.
     */
    @Command
    fun appExit(invoke: Invoke) {
        activity.runOnUiThread { activity.finish() }
        invoke.resolve()
    }

    /**
     * Android needs no code for this, and the method exists anyway.
     *
     * Backup here is a MANIFEST decision, not a runtime one: `scripts/native-permissions.ts`
     * writes `android:allowBackup="false"` for cloud backup and the `dataExtractionRules`
     * that govern device-to-device transfer, both of which are already in force by the time
     * any of this runs. iOS has no equivalent — `NSURLIsExcludedFromBackupKey` is set on the
     * URL at runtime — so the command exists for that platform and answers honestly here.
     *
     * Resolves rather than refusing. `src/lib/storage.ts` only asks on iOS, so nothing
     * reaches this today; if something ever does, "the directory is not in a backup" is a
     * true statement on Android and an error would be a false one.
     */
    @Command
    fun excludeFromBackup(invoke: Invoke) {
        invoke.resolve()
    }

    private fun statusObject(status: Status): JSObject = JSObject()
        .put("available", status.available)
        .put("biometry", status.biometry)
        .apply {
            // Omitted entirely when there is none — `AuthStatus::reason` is
            // `#[serde(default)]` on the Rust side precisely so this can stay absent
            // rather than carrying a null that means the same thing.
            status.reason?.let { put("reason", it.token) }
        }

    private fun Invoke.rejectWith(failure: Failure, detail: String?) =
        reject(detail ?: failure.token, failure.token)
}
