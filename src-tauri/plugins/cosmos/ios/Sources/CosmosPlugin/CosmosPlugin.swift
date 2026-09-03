import SwiftRs
import Tauri
import UIKit

/// Argument shapes.
///
/// Flat rather than nested, because `Prompt` is `#[serde(flatten)]`-ed into the request
/// structs on the Rust side — see `src-tauri/plugins/cosmos/src/models.rs`. Non-optional
/// on every required field, so a malformed payload fails to decode rather than reaching
/// the Keychain with an empty string.
class AuthStoreArgs: Decodable {
    let key: String
    let value: String
    let title: String
    let reason: String
    let cancel: String
}

class AuthReadArgs: Decodable {
    let key: String
    let title: String
    let reason: String
    let cancel: String
}

class AuthDeleteArgs: Decodable {
    let key: String
}

class ShareArgs: Decodable {
    let text: String
    let title: String?
}

class ExcludeBackupArgs: Decodable {
    let path: String
}

/// The bridge. Decodes arguments, forwards, and turns the answer back into an `Invoke`
/// resolution — no logic of its own, which is what keeps the two capabilities behind it
/// from growing shared behaviour.
///
/// Every rejection carries its `Failure` token as the `code`, because that is the field
/// `src-tauri/plugins/cosmos/src/error.rs` reads the classification back out of. Rejecting
/// with a message alone would reach the frontend as an unclassified `failed`, which paints
/// a red error line over a user who simply tapped "cancel".
class CosmosPlugin: Plugin {

    /// Keychain and LocalAuthentication calls BLOCK while their sheet is up. Run on the
    /// main thread they would deadlock the very run loop that has to draw it, so every
    /// auth command hops onto this queue first. UIKit presentation goes the other way —
    /// see `shareText`.
    private let queue = DispatchQueue(label: "lat.cosmospay.wallet.auth", qos: .userInitiated)

    @objc public func authStatus(_ invoke: Invoke) throws {
        queue.async {
            let status = DeviceAuth.status()
            var payload: [String: Any] = [
                "available": status.available,
                "biometry": status.biometry.rawValue,
            ]
            // Omitted entirely when there is none — `AuthStatus::reason` is
            // `#[serde(default)]` on the Rust side precisely so this can stay absent
            // rather than carrying a null that means the same thing.
            if let reason = status.reason {
                payload["reason"] = reason.rawValue
            }
            invoke.resolve(payload)
        }
    }

    @objc public func authStore(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AuthStoreArgs.self)
        queue.async {
            do {
                try DeviceAuth.store(
                    key: args.key,
                    value: args.value,
                    prompt: Prompt(title: args.title, reason: args.reason, cancel: args.cancel)
                )
                invoke.resolve()
            } catch {
                invoke.reject(error)
            }
        }
    }

    @objc public func authRead(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AuthReadArgs.self)
        queue.async {
            do {
                let value = try DeviceAuth.read(
                    key: args.key,
                    prompt: Prompt(title: args.title, reason: args.reason, cancel: args.cancel)
                )
                invoke.resolve(["value": value])
            } catch {
                invoke.reject(error)
            }
        }
    }

    @objc public func authDelete(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(AuthDeleteArgs.self)
        queue.async {
            // Always resolves: every caller is on a cleanup path and "there was nothing to
            // delete" is success. See `desktop.rs` for the same choice.
            DeviceAuth.delete(key: args.key)
            invoke.resolve()
        }
    }

    @objc public func shareText(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ShareArgs.self)
        DispatchQueue.main.async {
            guard let controller = self.manager.viewController else {
                // No sheet appeared. `failed` rather than `cancelled`, and the difference
                // is what makes `src/lib/share.ts` fall back to the clipboard instead of
                // assuming the user declined.
                invoke.reject(Failure.failed.rawValue, code: Failure.failed.rawValue)
                return
            }
            do {
                try ShareSheet.present(from: controller, text: args.text, title: args.title)
                invoke.resolve()
            } catch {
                invoke.reject(error.localizedDescription, code: Failure.failed.rawValue)
            }
        }
    }

    /// iOS has no hardware back button, so nothing ever emits the event that leads here.
    ///
    /// Resolves rather than refusing, and does NOT exit: an iOS app that terminates itself
    /// looks to the user like a crash, and Apple rejects it under the Human Interface
    /// Guidelines. If this is ever reached, doing nothing is the correct behaviour.
    @objc public func appExit(_ invoke: Invoke) throws {
        invoke.resolve()
    }

    /// Keep the app-data directory out of iCloud.
    ///
    /// This is the one platform where the wallet's storage is backup-eligible by default.
    /// Without it, `cosmos-wallet.json` — the AES-GCM sealed vault, and the plaintext wallet
    /// list beside it — is restored onto whatever device the user sets up next, where the
    /// password is the only thing left between an attacker and the seed, offline and at
    /// their own pace. The device-unlock envelope does not travel: its key is
    /// `.biometryCurrentSet` and stays on the phone that made it. The vault does.
    ///
    /// The DIRECTORY, not the file. `tauri-plugin-store` rewrites its file, and a resource
    /// value set on an inode does not survive that file being replaced; on a directory it
    /// covers everything written inside it, including the rewrite. The directory is created
    /// first when it does not exist yet, because this runs before the store's first write
    /// and `setResourceValues` on a missing path fails.
    ///
    /// Idempotent — setting the flag on an already-excluded directory is a no-op — so the
    /// once-per-launch call from `src/lib/storage.ts` needs no state on either side.
    @objc public func excludeFromBackup(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ExcludeBackupArgs.self)
        queue.async {
            do {
                var url = URL(fileURLWithPath: args.path, isDirectory: true)
                if !FileManager.default.fileExists(atPath: url.path) {
                    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
                }
                var values = URLResourceValues()
                values.isExcludedFromBackup = true
                try url.setResourceValues(values)
                invoke.resolve()
            } catch {
                // `failed`, with the platform's own sentence. Nothing here is classifiable
                // as a device-auth outcome, and the caller only logs it.
                invoke.reject(error.localizedDescription, code: Failure.failed.rawValue)
            }
        }
    }
}

/// Reject with the classification in `code`, whatever shape the error arrived in.
extension Invoke {
    fileprivate func reject(_ error: Error) {
        guard let classified = error as? DeviceAuthError else {
            // Not one of ours — a decoding fault, a UIKit throw. `failed` is the honest
            // answer: inventing a friendlier classification would be inventing a fact.
            reject(error.localizedDescription, code: Failure.failed.rawValue)
            return
        }
        reject(classified.detail ?? classified.failure.rawValue, code: classified.failure.rawValue)
    }
}

@_cdecl("init_plugin_cosmos")
func initPlugin() -> Plugin {
    return CosmosPlugin()
}
