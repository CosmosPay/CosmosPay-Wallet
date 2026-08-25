import UIKit

/// The iOS share sheet.
///
/// Shares a package with the secure store and nothing else — see the header on
/// `src-tauri/plugins/cosmos/src/lib.rs`. It exists because a WKWebView does not implement
/// `navigator.share`, so the one platform with a real share sheet was the one that
/// silently fell back to copying.
enum ShareSheet {

    /// Present `UIActivityViewController` over the app.
    ///
    /// Main thread only — UIKit presentation is not thread-safe and the caller reaches this
    /// from a background queue.
    ///
    /// The completion fires once the sheet closes, but the wallet is told the share
    /// SUCCEEDED as soon as the sheet appears. That is on purpose: `src/lib/share.ts` reads
    /// `false` as "no sheet exists, copy instead", and a user who opens the sheet and then
    /// changes their mind must not have their clipboard overwritten behind their back.
    static func present(from controller: UIViewController, text: String, title: String?) throws {
        let activity = UIActivityViewController(activityItems: [text], applicationActivities: nil)

        // An iPad presents this as a popover and CRASHES if it has no anchor. There is no
        // originating view here — the request came from the web layer — so it is anchored
        // to the middle of the presenting controller, with an empty rect so no arrow is
        // drawn pointing at nothing in particular.
        if let popover = activity.popoverPresentationController {
            popover.sourceView = controller.view
            popover.sourceRect = CGRect(
                x: controller.view.bounds.midX,
                y: controller.view.bounds.midY,
                width: 0,
                height: 0
            )
            popover.permittedArrowDirections = []
        }

        if let title {
            activity.setValue(title, forKey: "subject")
        }

        controller.present(activity, animated: true)
    }
}
