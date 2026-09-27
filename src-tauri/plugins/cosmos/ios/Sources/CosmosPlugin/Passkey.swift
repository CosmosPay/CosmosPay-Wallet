import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

/// Passkeys for the mobile app, through `ASAuthorization`.
///
/// The app's WebView has no WebAuthn of its own, so `src/lib/passkey.ts` hands the ceremony
/// to this file as standard WebAuthn JSON (`PublicKeyCredentialCreationOptionsJSON` /
/// `PublicKeyCredentialRequestOptionsJSON`, buffers in base64url) and expects the standard
/// `PublicKeyCredentialJSON` back. Unlike Android's Credential Manager, iOS takes no JSON,
/// so this file reads the few fields the wallet sends — `rp.id`/`rpId`, the user, the
/// challenge, `allowCredentials` and `extensions.prf.eval` — and writes the few it reads
/// back: the credential id and `clientExtensionResults.prf`.
///
/// iOS 18 IS THE FLOOR. It is the first release whose `ASAuthorization` evaluates PRF
/// (`ASAuthorizationPublicKeyCredentialPRFAssertionInput`), and a passkey without PRF holds
/// nothing the wallet can use. Older phones answer `unsupported`, and the wallet keeps the
/// password and Face ID unlock it always had there.
///
/// WHAT MAKES THE PASSKEY THE WEB'S TOO. The request names the relying party `cosmospay.lat`,
/// and iOS lets this app use a passkey for that domain only when the app carries the
/// `webcredentials:cosmospay.lat` associated-domain entitlement (`scripts/native-permissions.ts`
/// writes it) AND the domain serves `/.well-known/apple-app-site-association` naming the app
/// (`scripts/passkey-well-known.ts`). Without both, the ceremony fails with the platform's
/// "not associated with domain" sentence, carried back as the detail on `failed`.
///
/// Nothing here holds a secret. The PRF output passes through to the web layer, which is
/// where `lib/passkeyUnlock.ts` and `lib/cloudBackup.ts` use it; the Keychain work in
/// `DeviceAuth.swift` is unrelated and untouched.
enum Passkey {

    static func available() -> Bool {
        if #available(iOS 18.0, *) { return true }
        return false
    }

    /// Runs on the main thread — `ASAuthorizationController` presents UI — and calls
    /// `completion` exactly once, with the JSON to resolve or a classified failure.
    static func create(requestJson: String, anchor: ASPresentationAnchor, completion: @escaping (Result<String, DeviceAuthError>) -> Void) {
        guard #available(iOS 18.0, *) else { return completion(.failure(DeviceAuthError(.unsupported))) }
        do {
            let json = try WebAuthnJson.parse(requestJson)
            let rp = try WebAuthnJson.string(json, ["rp", "id"])
            let user = try WebAuthnJson.object(json, "user")
            let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rp)
            let request = provider.createCredentialRegistrationRequest(
                challenge: try WebAuthnJson.bytes(json, ["challenge"]),
                name: try WebAuthnJson.string(user, ["name"]),
                userID: try WebAuthnJson.bytes(user, ["id"])
            )
            request.userVerificationPreference = .required
            if let prf = try WebAuthnJson.prfInputs(json) {
                request.prf = .inputValues(prf)
            }
            Ceremony.run(request, anchor: anchor, completion: completion)
        } catch let error as DeviceAuthError {
            completion(.failure(error))
        } catch {
            completion(.failure(DeviceAuthError(.failed, error.localizedDescription)))
        }
    }

    static func get(requestJson: String, anchor: ASPresentationAnchor, completion: @escaping (Result<String, DeviceAuthError>) -> Void) {
        guard #available(iOS 18.0, *) else { return completion(.failure(DeviceAuthError(.unsupported))) }
        do {
            let json = try WebAuthnJson.parse(requestJson)
            let rp = try WebAuthnJson.string(json, ["rpId"])
            let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rp)
            let request = provider.createCredentialAssertionRequest(challenge: try WebAuthnJson.bytes(json, ["challenge"]))
            request.userVerificationPreference = .required
            let allowed = (json["allowCredentials"] as? [[String: Any]] ?? []).compactMap { entry -> Data? in
                guard let id = entry["id"] as? String else { return nil }
                return WebAuthnJson.decode(id)
            }
            if !allowed.isEmpty {
                request.allowedCredentials = allowed.map { ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0) }
            }
            if let prf = try WebAuthnJson.prfInputs(json) {
                request.prf = .inputValues(prf)
            }
            Ceremony.run(request, anchor: anchor, completion: completion)
        } catch let error as DeviceAuthError {
            completion(.failure(error))
        } catch {
            completion(.failure(DeviceAuthError(.failed, error.localizedDescription)))
        }
    }
}

/// One `ASAuthorizationController` run. Holds itself until the delegate answers — the
/// controller keeps only a weak reference to its delegate, and a ceremony released early
/// would leave the sheet up with nobody to hear the answer.
@available(iOS 18.0, *)
private final class Ceremony: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private static var running: Set<Ceremony> = []

    private let anchor: ASPresentationAnchor
    private let completion: (Result<String, DeviceAuthError>) -> Void
    private var done = false

    private init(anchor: ASPresentationAnchor, completion: @escaping (Result<String, DeviceAuthError>) -> Void) {
        self.anchor = anchor
        self.completion = completion
    }

    static func run(_ request: ASAuthorizationRequest, anchor: ASPresentationAnchor, completion: @escaping (Result<String, DeviceAuthError>) -> Void) {
        let ceremony = Ceremony(anchor: anchor, completion: completion)
        running.insert(ceremony)
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = ceremony
        controller.presentationContextProvider = ceremony
        controller.performRequests()
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        anchor
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        switch authorization.credential {
        case let created as ASAuthorizationPlatformPublicKeyCredentialRegistration:
            let prf = created.prf
            finish(.success(WebAuthnJson.credential(
                id: created.credentialID,
                prfEnabled: prf?.isSupported ?? false,
                first: prf?.first.map(WebAuthnJson.bytes(of:)),
                second: prf?.second.map(WebAuthnJson.bytes(of:))
            )))
        case let asserted as ASAuthorizationPlatformPublicKeyCredentialAssertion:
            let prf = asserted.prf
            finish(.success(WebAuthnJson.credential(
                id: asserted.credentialID,
                prfEnabled: prf != nil,
                first: prf.map { WebAuthnJson.bytes(of: $0.first) },
                second: prf?.second.map(WebAuthnJson.bytes(of:))
            )))
        default:
            finish(.failure(DeviceAuthError(.failed, "the platform returned no public-key credential")))
        }
    }

    /// A dismissed sheet is `cancelled` and gets no red line; a request the platform could
    /// not serve at all is `unsupported`, which makes the screen offer a password. Anything
    /// else is `failed` with the platform's sentence — "not associated with domain" among
    /// them, which is the one that tells an operator the entitlement or the AASA file is
    /// missing.
    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let code = (error as? ASAuthorizationError)?.code
        switch code {
        case .canceled:
            finish(.failure(DeviceAuthError(.cancelled)))
        case .notHandled, .notInteractive:
            finish(.failure(DeviceAuthError(.unsupported, error.localizedDescription)))
        default:
            finish(.failure(DeviceAuthError(.failed, error.localizedDescription)))
        }
    }

    private func finish(_ result: Result<String, DeviceAuthError>) {
        guard !done else { return }
        done = true
        completion(result)
        Ceremony.running.remove(self)
    }
}

/// The few WebAuthn JSON fields this file reads and writes.
enum WebAuthnJson {

    static func parse(_ text: String) throws -> [String: Any] {
        guard let data = text.data(using: .utf8),
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw DeviceAuthError(.failed, "the ceremony is not a JSON object")
        }
        return json
    }

    static func object(_ json: [String: Any], _ key: String) throws -> [String: Any] {
        guard let value = json[key] as? [String: Any] else { throw DeviceAuthError(.failed, "missing \(key)") }
        return value
    }

    static func string(_ json: [String: Any], _ path: [String]) throws -> String {
        var node: Any? = json
        for key in path { node = (node as? [String: Any])?[key] }
        guard let value = node as? String, !value.isEmpty else {
            throw DeviceAuthError(.failed, "missing \(path.joined(separator: "."))")
        }
        return value
    }

    static func bytes(_ json: [String: Any], _ path: [String]) throws -> Data {
        guard let data = decode(try string(json, path)) else {
            throw DeviceAuthError(.failed, "\(path.joined(separator: ".")) is not base64url")
        }
        return data
    }

    /// `extensions.prf.eval` as the platform's input: the wallet always sends both salts.
    @available(iOS 18.0, *)
    static func prfInputs(_ json: [String: Any]) throws -> ASAuthorizationPublicKeyCredentialPRFAssertionInput.InputValues? {
        guard let prf = (json["extensions"] as? [String: Any])?["prf"] as? [String: Any],
              let eval = prf["eval"] as? [String: Any] else { return nil }
        guard let first = (eval["first"] as? String).flatMap(decode) else {
            throw DeviceAuthError(.failed, "prf.eval.first is not base64url")
        }
        let second = (eval["second"] as? String).flatMap(decode)
        return .init(saltInput1: first, saltInput2: second)
    }

    @available(iOS 18.0, *)
    static func bytes(of key: SymmetricKey) -> Data {
        key.withUnsafeBytes { Data($0) }
    }

    /// `PublicKeyCredentialJSON`, reduced to what `credentialFromJson` in `src/lib/passkey.ts`
    /// reads. No attestation and no signature: nothing verifies an assertion here, the PRF
    /// output is the point, and the platform releases it only to a verified user.
    static func credential(id: Data, prfEnabled: Bool, first: Data?, second: Data?) -> String {
        var prf: [String: Any] = ["enabled": prfEnabled]
        if let first {
            var results: [String: Any] = ["first": encode(first)]
            if let second { results["second"] = encode(second) }
            prf["results"] = results
        }
        let json: [String: Any] = [
            "id": encode(id),
            "rawId": encode(id),
            "type": "public-key",
            "clientExtensionResults": ["prf": prf],
        ]
        let data = (try? JSONSerialization.data(withJSONObject: json)) ?? Data("{}".utf8)
        return String(decoding: data, as: UTF8.self)
    }

    static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func decode(_ text: String) -> Data? {
        var b64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        let pad = (4 - b64.count % 4) % 4
        b64 += String(repeating: "=", count: pad)
        return Data(base64Encoded: b64)
    }
}
