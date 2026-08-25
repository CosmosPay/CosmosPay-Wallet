import Foundation
import LocalAuthentication
import Security

/// The iOS half of the wallet's secure store.
///
/// The contract, in one sentence: a value written here can only be read back by an
/// operation that is ITSELF a live biometric check. Not "a check, then a read" — the same
/// operation. `src/lib/deviceAuth.ts` explains why the wallet refuses the weaker shape;
/// this file is what makes the stronger one true on iOS.
///
/// How: the item is a Keychain entry carrying a `SecAccessControl` built from
///
///  - `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` — it does not exist on a device
///    with no passcode, it is excluded from every backup, and it cannot be restored onto
///    another device. This is the attribute the Capacitor plugin this replaced omitted
///    entirely: its unbound tier defaulted to `kSecAttrAccessibleWhenUnlocked`, which is
///    backup-eligible, so the wrapping key rode an encrypted backup onto a stranger's
///    phone where the envelope — in UserDefaults, also backed up — then opened with the
///    stranger's own face;
///  - `.biometryCurrentSet` — enrolling a new face or finger destroys the item rather than
///    granting the new one access to the old wallet. The Android half spells this
///    `setInvalidatedByBiometricEnrollment(true)`.
///
/// `SecItemCopyMatching` against such an item raises the Face ID / Touch ID sheet itself
/// and returns the bytes only on success. There is deliberately no `evaluatePolicy` call
/// on the read path: a check that is not the same operation as the read is a check the
/// read can skip.
///
/// Nothing here is ever handed a password or a seed. The value is the 32-byte wrapping key
/// from `src/lib/deviceAuth.ts`, already base64; the password it opens is sealed separately
/// and stored somewhere else entirely.
enum DeviceAuth {

    /// Keychain service namespace. The caller's key becomes the account within it.
    private static let service = "lat.cosmospay.wallet.auth"

    // MARK: - availability

    /// What this device can do right now.
    ///
    /// `deviceOwnerAuthenticationWithBiometrics`, never `deviceOwnerAuthentication`: the
    /// second one includes the passcode, and a passcode cannot open a `.biometryCurrentSet`
    /// item — the user would type it, succeed, and meet a Keychain error. Asking about a
    /// capability this module does not use would report a feature that does not exist.
    static func status() -> Status {
        let context = LAContext()
        var error: NSError?
        // Must be called before `biometryType` is meaningful — it is what populates it.
        let ok = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        let kind = biometryKind(context)

        if ok {
            return Status(available: true, biometry: kind, reason: nil)
        }

        guard let code = error.map({ LAError.Code(rawValue: $0.code) }) ?? nil else {
            return Status(available: false, biometry: kind, reason: .failed)
        }

        switch code {
        case .biometryNotEnrolled:
            // A sensor with nothing enrolled on it. A trip to Settings fixes this, which is
            // what separates it from everything below.
            return Status(available: false, biometry: kind, reason: .notEnrolled)
        case .biometryLockout:
            return Status(available: false, biometry: kind, reason: .lockedOut)
        case .passcodeNotSet:
            // No lock screen at all, so there is nothing to bind anything to — and
            // `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` would refuse to store it.
            return Status(available: false, biometry: kind, reason: .noPasscode)
        case .biometryNotAvailable:
            // Either there is no sensor, or the user switched it off for this app. The
            // second is far more common, and both leave the wallet on its password.
            return Status(available: false, biometry: kind, reason: kind == .generic ? .noHardware : .noStrongBiometry)
        default:
            return Status(available: false, biometry: kind, reason: .failed)
        }
    }

    /// Display only — it words the button and never decides anything.
    private static func biometryKind(_ context: LAContext) -> Biometry {
        switch context.biometryType {
        case .faceID:
            return .face
        case .touchID:
            return .fingerprint
        default:
            // `.opticID` exists only on visionOS and `.none` is what a simulator or a
            // pre-check context reports. Neither is a case the copy distinguishes.
            return .generic
        }
    }

    // MARK: - store

    /// Seal `value` under a fresh access-controlled item, raising the prompt to do it.
    ///
    /// DELETE FIRST, ALWAYS. A second enrolment for the same wallet — which is what a
    /// password change is — must not land on `errSecDuplicateItem`, and must not leave the
    /// PREVIOUS item behind: the old one is bound to the old biometric set and holds a
    /// wrapping key for a superseded password.
    ///
    /// The prompt here is a CONFIRMATION, not the binding. iOS does not require
    /// authentication to *write* an access-controlled item, so without the explicit
    /// evaluation below a wallet would enrol silently — and `enableDeviceAuth` in
    /// `src/lib/deviceAuth.ts` is written around a sheet being shown inside this call: it
    /// re-checks the session epoch afterwards precisely because the auto-lock can fire
    /// while that sheet is open. The binding itself is on the read, where it belongs.
    static func store(key: String, value: String, prompt: Prompt) throws {
        delete(key: key)

        guard let data = value.data(using: .utf8) else {
            throw DeviceAuthError(.failed, "value is not valid UTF-8")
        }

        var accessError: Unmanaged<CFError>?
        guard
            let access = SecAccessControlCreateWithFlags(
                nil,
                kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
                .biometryCurrentSet,
                &accessError
            )
        else {
            let detail = (accessError?.takeRetainedValue() as Error?)?.localizedDescription
            // The commonest cause by far is a device with no passcode, which is the one
            // condition `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` will not tolerate.
            throw DeviceAuthError(.noPasscode, detail)
        }

        let context = try authenticated(prompt)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessControl as String: access,
            kSecUseAuthenticationContext as String: context,
        ]

        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw error(from: status)
        }
    }

    /// Raise the sheet once, so enrolment is something the user consciously did.
    ///
    /// Reusing the resulting context for the write is what stops it being a second prompt:
    /// the Keychain accepts the evaluation that just happened rather than asking again.
    private static func authenticated(_ prompt: Prompt) throws -> LAContext {
        let context = LAContext()
        context.localizedCancelTitle = prompt.cancel
        // Zero, not a convenience window: a reusable context is exactly the "one check,
        // many reads" shape the read path refuses.
        context.touchIDAuthenticationAllowableReuseDuration = 0

        let semaphore = DispatchSemaphore(value: 0)
        var failure: Failure?
        var detail: String?

        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: prompt.reason) { ok, err in
            if !ok {
                let code = (err as NSError?).map { LAError.Code(rawValue: $0.code) } ?? nil
                failure = failureFrom(code)
                detail = err?.localizedDescription
            }
            semaphore.signal()
        }
        semaphore.wait()

        if let failure {
            throw DeviceAuthError(failure, detail)
        }
        return context
    }

    // MARK: - read

    /// Prompt, and return the value. The prompt IS the read.
    ///
    /// `SecItemCopyMatching` blocks while the sheet is up, which is why every caller of
    /// this reaches it from a background queue — see `CosmosPlugin.swift`.
    static func read(key: String, prompt: Prompt) throws -> String {
        let context = LAContext()
        context.localizedCancelTitle = prompt.cancel
        context.localizedReason = prompt.reason

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseAuthenticationContext as String: context,
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        guard status == errSecSuccess else {
            throw error(from: status)
        }
        guard let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
            // The item opened but its bytes are not what we wrote. Nothing here is
            // recoverable and leaving it would fail the same way forever.
            delete(key: key)
            throw DeviceAuthError(.stale, "stored value is unreadable")
        }
        return value
    }

    // MARK: - delete

    /// Forget the item. Never throws: every caller is on a cleanup path, and
    /// `errSecItemNotFound` means the job was already done.
    static func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }

    // MARK: - classification

    /// Keychain `OSStatus` values, mapped onto the wallet's vocabulary.
    private static func error(from status: OSStatus) -> DeviceAuthError {
        let detail = SecCopyErrorMessageString(status, nil) as String?
        switch status {
        case errSecItemNotFound:
            // The item is gone: a changed biometric set invalidated it, or the app was
            // reinstalled. `stale` is what makes the frontend clear the enrolment instead
            // of offering a button that can only ever fail.
            return DeviceAuthError(.stale, detail)
        case errSecUserCanceled:
            return DeviceAuthError(.cancelled, detail)
        case errSecAuthFailed:
            return DeviceAuthError(.failed, detail)
        case errSecInteractionNotAllowed:
            // The device is locked. Not a fault the user can clear from inside this sheet.
            return DeviceAuthError(.failed, detail)
        case errSecDuplicateItem:
            // Unreachable: `store` deletes first. If it ever happens the previous item is
            // still in place holding a key for a password that is no longer current.
            return DeviceAuthError(.failed, detail)
        default:
            return DeviceAuthError(.failed, detail)
        }
    }

    /// `LAError` codes, mapped onto the wallet's vocabulary.
    private static func failureFrom(_ code: LAError.Code?) -> Failure {
        switch code {
        case .userCancel, .appCancel, .systemCancel:
            return .cancelled
        // A dismissed sheet in favour of the passcode is still the user choosing to type
        // their password instead, and must not be met with a red error line.
        case .userFallback:
            return .cancelled
        case .biometryNotEnrolled:
            return .notEnrolled
        case .biometryNotAvailable:
            return .noHardware
        case .passcodeNotSet:
            return .noPasscode
        case .biometryLockout:
            return .lockedOut
        case .authenticationFailed:
            return .failed
        default:
            return .failed
        }
    }
}
