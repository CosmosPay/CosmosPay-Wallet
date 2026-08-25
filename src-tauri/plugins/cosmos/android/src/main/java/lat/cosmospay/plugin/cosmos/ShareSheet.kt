package lat.cosmospay.plugin.cosmos

import android.app.Activity
import android.content.Intent

/**
 * The Android share sheet.
 *
 * Shares a crate with the secure store and nothing else — see the header on
 * `src-tauri/plugins/cosmos/src/lib.rs`. It exists because an Android WebView does not
 * implement `navigator.share`, so the one platform with a real share sheet was the one
 * that silently fell back to copying.
 */
internal object ShareSheet {

    /**
     * Raise the chooser.
     *
     * `createChooser` rather than the bare `ACTION_SEND`: the bare intent throws
     * `ActivityNotFoundException` on a device with nothing that accepts `text/plain`, and
     * on a device with exactly one such app it silently skips the choice the user was
     * offered. The chooser is itself an activity, so it always resolves.
     *
     * The whole call is wrapped by the caller: what reaches the wallet is `false`, which
     * makes it copy to the clipboard instead — see `src/lib/share.ts`.
     */
    fun share(activity: Activity, text: String, title: String?) {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
            // A subject is what an email client fills its subject line with. Absent for a
            // messenger, which is the common case, so it stays optional rather than being
            // defaulted to something the wallet made up.
            if (title != null) putExtra(Intent.EXTRA_SUBJECT, title)
        }
        activity.startActivity(Intent.createChooser(send, title))
    }
}
