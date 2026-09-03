/**
 * Declare, in the generated native projects, the permissions the WebView needs at runtime.
 *
 * Run by `npm run android:init` / `npm run ios:init` right after the platform is generated,
 * and re-runnable on its own as `npm run native:perms`.
 *
 * It exists because `src-tauri/gen/` is a Tauri OUTPUT: `tauri android init` and
 * `tauri ios init` rewrite the manifest and the Info.plist from their own templates, which
 * declare INTERNET and nothing else. A permission edited straight into `gen/` survives until
 * the next init and then disappears, and the failure is silent — the camera simply never
 * opens. The declarations live here, in a committed source, so re-running init is safe.
 *
 * Nothing here grants anything. It declares what the OS is *allowed to ask the user for*; the
 * prompt itself is the WebView's, raised the first time the web layer touches the API.
 *
 * No image work, no XML parser and no dependencies — the files are line-oriented templates
 * and the insertions are checked for before they are made, so running this twice is a no-op.
 */
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';

const ANDROID_MANIFEST = 'src-tauri/gen/android/app/src/main/AndroidManifest.xml';
const ANDROID_XML_DIR = 'src-tauri/gen/android/app/src/main/res/xml';

/* --------------------------- shared helpers --------------------------- */
/* Declared here rather than further down because the iOS path discovery below is their
   first caller, and it runs at module scope. */

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

const log = (msg: string) => console.log(`native:perms — ${msg}`);

/* ------------------------------- ios paths -------------------------------
   The iOS project directory cannot be a constant the way the Android paths can: it is
   generated, and its name is not ours to choose. Resolved once, at startup. */
const IOS_GEN_ROOT = 'src-tauri/gen/apple';

/**
 * `_iOS` is Tauri's naming rule, but the stem is the CARGO PACKAGE name and not
 * `productName` — the generated project is `cosmos-wallet.xcodeproj`, not "Cosmos Pay".
 * So the suffix is the only part worth matching on, and even that is a convention rather
 * than a contract.
 *
 * Hence the fallback: any directory holding an `Info.plist` is the app directory, whatever
 * Tauri decided to call it. Without it a rename downstream would make every patch below a
 * silent no-op — the exact failure mode CLAUDE.md warns about for generated trees, where
 * nothing errors and the app simply ships without its purpose strings and crashes the first
 * time it touches the camera.
 */
async function findIosAppDir(): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(IOS_GEN_ROOT, { withFileTypes: true });
  } catch {
    return null; // `tauri ios init` has not run here (or this is not macOS)
  }

  const dirs = entries.filter((e) => e.isDirectory());
  const byName = dirs.find((e) => e.name.endsWith('_iOS'));
  if (byName) return `${IOS_GEN_ROOT}/${byName.name}`;

  for (const dir of dirs) {
    if (await exists(`${IOS_GEN_ROOT}/${dir.name}/Info.plist`)) return `${IOS_GEN_ROOT}/${dir.name}`;
  }

  // The platform WAS generated — the directory exists — and nothing in it looks like an
  // app. Said out loud rather than returned as "no iOS project", because the two are
  // indistinguishable to the caller and only one of them is a problem.
  log(`ERROR — ${IOS_GEN_ROOT} exists but no app directory was found inside it.`);
  log('  Tauri renamed the generated project; update findIosAppDir() in this script.');
  log('  Purpose strings were NOT written, and iOS terminates the app when it needs one.');
  return null;
}

const IOS_APP_DIR = await findIosAppDir();
const IOS_PLIST = IOS_APP_DIR ? `${IOS_APP_DIR}/Info.plist` : '';
const IOS_PRIVACY_MANIFEST = IOS_APP_DIR ? `${IOS_APP_DIR}/PrivacyInfo.xcprivacy` : '';

/** The Xcode project sits beside the app directory, not inside it. */
async function findIosPbxproj(): Promise<string> {
  try {
    const entries = await readdir(IOS_GEN_ROOT, { withFileTypes: true });
    const proj = entries.find((e) => e.isDirectory() && e.name.endsWith('.xcodeproj'));
    return proj ? `${IOS_GEN_ROOT}/${proj.name}/project.pbxproj` : '';
  } catch {
    return '';
  }
}

const IOS_PBXPROJ = await findIosPbxproj();

/**
 * `<uses-permission>` entries.
 *
 * CAMERA is not optional for the scanner: `src/features/extras/ScanQR.tsx` calls
 * `navigator.mediaDevices.getUserMedia`, the Android WebView turns that into a runtime request
 * for `Manifest.permission.CAMERA`, and Android denies a request for a permission the manifest
 * never declared *without showing a dialog*. The user sees "camera unavailable" and has nothing
 * to tap.
 *
 * USE_BIOMETRIC is the same story for `src/lib/deviceAuth.ts`: BiometricPrompt refuses to show
 * without it, so "unlock with your fingerprint" fails on a device that has one enrolled, and the
 * only clue is a logcat line. It is a normal-protection permission — declaring it raises no
 * install-time prompt and asks the user for nothing.
 *
 * It is ALSO declared by the wallet's own plugin
 * (src-tauri/plugins/cosmos/android/src/main/AndroidManifest.xml), and listed here anyway. The
 * manifest merger deduplicates the pair, so the cost is nothing; what it buys is that neither
 * declaration is load-bearing on its own. The plugin owns it because the plugin is what raises
 * the prompt; the app declares it because a merge that silently failed would take the unlock
 * feature with it, and this file is the one a reviewer reads.
 */
const PERMISSIONS = ['android.permission.CAMERA', 'android.permission.USE_BIOMETRIC'];

/**
 * `<uses-feature ... required="false">` entries.
 *
 * Google Play reads a CAMERA permission as an implicit *requirement* for
 * `android.hardware.camera` and `android.hardware.camera.autofocus`, and hides the listing from
 * every device that has neither — emulators, Chromebooks, camera-less tablets. The scanner is
 * one screen out of thirty and it already ships two fallbacks (upload an image, paste one), so
 * the app must stay installable without a camera. `required="false"` is what says so.
 *
 * `android.hardware.fingerprint` is listed for the same defensive reason, and it matters more
 * here than it looks: a phone with no sensor at all, and a phone with a sensor nobody enrolled,
 * are both perfectly good wallets — `lib/deviceAuth.ts` reports the feature as unavailable and
 * the password works everywhere. Neither device may be filtered out of the Play listing over a
 * convenience feature that was never the point.
 */
const FEATURES = [
  'android.hardware.camera',
  'android.hardware.camera.autofocus',
  'android.hardware.fingerprint',
];

/**
 * `<queries>` — package visibility, API 30+.
 *
 * The KYC photo step (`src/features/fiat/PhotoStep.tsx`) renders `<input type="file" capture>`,
 * which the WebView serves from `onShowFileChooser` by resolving an ACTION_IMAGE_CAPTURE intent
 * first. Under targetSdk 30+ an app cannot see another package's activities unless it declares
 * the intent it wants to match, so `resolveActivity` returns null on every device and the
 * chooser falls back to the gallery picker: "take a photo" quietly becomes "pick a file".
 */
const INTENT_QUERIES = ['android.media.action.IMAGE_CAPTURE'];

/**
 * iOS purpose strings.
 *
 * Stricter than Android's: a missing key is not a denial but a crash — the OS terminates the
 * app the moment the API is touched. These are the App Store's base-language (English) strings;
 * translating them means adding `InfoPlist.strings` per locale, not editing these.
 */
const IOS_USAGE: { key: string; value: string }[] = [
  {
    key: 'NSCameraUsageDescription',
    value: 'Cosmos Wallet uses the camera to scan Stellar payment QR codes and to photograph the documents an identity check asks for.',
  },
  {
    // Face ID only. Touch ID and the device passcode need no purpose string, but a
    // missing NSFaceIDUsageDescription is not a denied prompt — iOS terminates the app
    // the moment LocalAuthentication is touched, so the first Face ID unlock on a Face ID
    // phone would be a crash rather than a refusal.
    key: 'NSFaceIDUsageDescription',
    value: 'Cosmos Wallet uses Face ID to unlock your wallet and confirm signatures, so you do not have to type your password every time. Your password always keeps working.',
  },
  {
    key: 'NSPhotoLibraryUsageDescription',
    value: 'Cosmos Wallet opens your photo library when you import a QR image, choose a wallet avatar, or attach a document to an identity check.',
  },
];

/* ------------------------------- android ------------------------------- */

/**
 * Both sides are optional on purpose, exactly as in android-res.ts: this also runs on a
 * checkout where only the iOS platform has been generated, or neither. Failing there would
 * break `npm run android:init` itself, over a permission.
 */
async function patchAndroid(): Promise<void> {
  if (!(await exists(ANDROID_MANIFEST))) {
    log(`no ${ANDROID_MANIFEST}, skipping (generate it with \`npm run android:init\`).`);
    return;
  }

  const before = await readFile(ANDROID_MANIFEST, 'utf8');
  const lines: string[] = [];

  // Match on the fully-qualified name, not on the whole element: Capacitor's template writes
  // ` />` where an Android Studio edit writes `/>`, and a byte comparison would duplicate the
  // entry — which aapt rejects as a duplicate attribute, failing the build.
  for (const name of PERMISSIONS) {
    if (!before.includes(`"${name}"`)) lines.push(`    <uses-permission android:name="${name}" />`);
  }
  for (const name of FEATURES) {
    if (!before.includes(`"${name}"`)) {
      lines.push(`    <uses-feature android:name="${name}" android:required="false" />`);
    }
  }

  const queries = INTENT_QUERIES.filter((action) => !before.includes(`"${action}"`));
  if (queries.length) {
    lines.push('    <queries>');
    for (const action of queries) {
      lines.push('        <intent>', `            <action android:name="${action}" />`, '        </intent>');
    }
    lines.push('    </queries>');
  }

  if (!lines.length) {
    log(`${ANDROID_MANIFEST} already declares everything.`);
    return;
  }

  // Before </manifest> rather than after the template's `<!-- Permissions -->` comment: the
  // comment is the template's, so it is one `cap migrate` away from moving or disappearing,
  // while the closing tag is the one landmark an AndroidManifest cannot be missing.
  const close = before.lastIndexOf('</manifest>');
  if (close < 0) {
    log(`${ANDROID_MANIFEST} has no </manifest> — leaving it alone.`);
    return;
  }
  const block = `\n    <!-- Added by scripts/native-permissions.ts — android/ is generated. -->\n${lines.join('\n')}\n\n`;
  await writeFile(ANDROID_MANIFEST, before.slice(0, close) + block + before.slice(close));
  log(`${ANDROID_MANIFEST} +${lines.length} line(s).`);
}

/* --------------------------------- ios --------------------------------- */

async function patchIos(): Promise<void> {
  if (!IOS_PLIST || !(await exists(IOS_PLIST))) {
    log('no generated iOS project, skipping (generate it with `npm run ios:init`, on macOS).');
    return;
  }

  const before = await readFile(IOS_PLIST, 'utf8');
  const missing = IOS_USAGE.filter((entry) => !before.includes(`<key>${entry.key}</key>`));
  if (!missing.length) {
    log(`${IOS_PLIST} already declares everything.`);
    return;
  }

  // The root <dict> is the last one to close, so its terminator is the last one in the file.
  const close = before.lastIndexOf('</dict>');
  if (close < 0) {
    log(`${IOS_PLIST} has no </dict> — leaving it alone.`);
    return;
  }
  // Tabs, because that is what Tauri's template uses and a plist diff should stay readable.
  const block = missing.map((e) => `\t<key>${e.key}</key>\n\t<string>${e.value}</string>\n`).join('');
  await writeFile(IOS_PLIST, before.slice(0, close) + block + before.slice(close));
  log(`${IOS_PLIST} +${missing.length} key(s).`);
}

/* ---------------------------- android backup ---------------------------- */

/**
 * Keep the encrypted vault off Google Drive.
 *
 * Android Auto Backup is ON unless a manifest says otherwise, and it uploads the app's
 * SharedPreferences to the user's Drive. That is where `lib/storage.ts`
 * puts everything: the AES-GCM sealed seed (`cosmos.w.<id>`), the sealed device-unlock
 * envelope (`cosmos.auth.<id>`), and the PLAINTEXT wallet list — which carries name, email,
 * birthdate, gender and the avatar image. The sealed blobs are only as strong as the
 * minimum password in `src/lib/validate.ts` once they are somewhere an attacker can grind
 * them offline, and the plaintext half needs no attack at all. A non-custodial wallet's
 * storage should not leave the device it was created on.
 *
 * Two mechanisms, because one is not enough on a modern target. `allowBackup="false"` stops
 * cloud backup. Device-to-device transfer on Android 12+ is governed separately by
 * `dataExtractionRules`, so a manifest with only the flag still hands the vault to the next
 * phone during setup-wizard migration. `fullBackupContent` covers API 30 and below, where
 * `dataExtractionRules` is ignored.
 */
const DATA_EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/native-permissions.ts — android/ is a build output. -->
<data-extraction-rules>
    <cloud-backup>
        <exclude domain="root" />
        <exclude domain="file" />
        <exclude domain="database" />
        <exclude domain="sharedpref" />
        <exclude domain="external" />
    </cloud-backup>
    <device-transfer>
        <exclude domain="root" />
        <exclude domain="file" />
        <exclude domain="database" />
        <exclude domain="sharedpref" />
        <exclude domain="external" />
    </device-transfer>
</data-extraction-rules>
`;

const BACKUP_RULES = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/native-permissions.ts — API 30 and below. -->
<full-backup-content>
    <exclude domain="root" path="." />
    <exclude domain="file" path="." />
    <exclude domain="database" path="." />
    <exclude domain="sharedpref" path="." />
    <exclude domain="external" path="." />
</full-backup-content>
`;

async function patchAndroidBackup(): Promise<void> {
  if (!(await exists(ANDROID_MANIFEST))) return; // patchAndroid() already said so

  await mkdir(ANDROID_XML_DIR, { recursive: true });
  await writeFile(`${ANDROID_XML_DIR}/data_extraction_rules.xml`, DATA_EXTRACTION_RULES);
  await writeFile(`${ANDROID_XML_DIR}/backup_rules.xml`, BACKUP_RULES);

  const before = await readFile(ANDROID_MANIFEST, 'utf8');
  let after = before;

  // Rewriting `="true"` specifically (not the whole line) keeps the edit idempotent and
  // leaves an already-false manifest untouched.
  after = after.replace(/android:allowBackup="true"/g, 'android:allowBackup="false"');

  // ...and when the attribute is absent entirely, WRITE IT. This function was authored
  // against the Capacitor template, which always emitted `android:allowBackup="true"`, so a
  // replace was enough. Tauri's template emits no such attribute, which means the replace
  // above matched nothing and the guard below refused every Android build — correctly, and
  // for the whole time the wallet has been generating its manifest from Tauri. A refusal is
  // the right failure, but it is not the right resting state: the attribute has to end up in
  // the manifest for an APK to exist at all.
  //
  // Anchored on the `<application` tag name rather than on any attribute the template
  // happens to write, because the tag name is the part that cannot change while the file is
  // still an AndroidManifest. Inserted immediately after it, so it lands inside the open tag
  // whether the template writes its attributes on one line or many.
  if (!after.includes('android:allowBackup="false"')) {
    const open = after.indexOf('<application');
    if (open >= 0) {
      const at = open + '<application'.length;
      after = `${after.slice(0, at)}\n        android:allowBackup="false"${after.slice(at)}`;
    }
  }

  // FAIL LOUD, NOT OPEN. Everything below anchors on `android:allowBackup="false"` being
  // present. If the manifest carries no `<application>` element at all, the insert above
  // matches nothing, both insertions below find no anchor, `after === before`, and the old
  // code logged "already keeps app data out of backups." for a build shipping the platform
  // default — which is `true`. The whole point of this function is that the sealed seed does
  // not go to Google Drive; a silent no-op is the one outcome it must never have.
  if (!after.includes('android:allowBackup="false"')) {
    log(`ERROR — ${ANDROID_MANIFEST} has no <application> element to carry android:allowBackup.`);
    log('  Android Auto Backup defaults to ON, which uploads the sealed vault and the');
    log('  plaintext wallet list to the user\'s Drive.');
    log('  Add android:allowBackup="false" to <application> before shipping this build.');
    process.exitCode = 1;
    return;
  }

  for (const [attr, value] of [
    ['android:dataExtractionRules', '@xml/data_extraction_rules'],
    ['android:fullBackupContent', '@xml/backup_rules'],
  ] as const) {
    if (after.includes(`${attr}=`)) continue;
    // Anchor on the allowBackup attribute we just normalised: it is on the <application>
    // element, which is the only place these belong, and it is guaranteed present.
    after = after.replace('android:allowBackup="false"', `android:allowBackup="false"\n        ${attr}="${value}"`);
  }

  if (after === before) {
    log(`${ANDROID_MANIFEST} already keeps app data out of backups.`);
    return;
  }
  await writeFile(ANDROID_MANIFEST, after);
  log(`${ANDROID_MANIFEST} — backups disabled (cloud + device transfer).`);
}

/* --------------------------- ios privacy manifest --------------------------- */

/**
 * `PrivacyInfo.xcprivacy` — required by App Store review since May 2024.
 *
 * Two required-reason categories, both for the same reason: the wallet reads back its own
 * files, never another app's data. An app that touches one without declaring it is rejected
 * automatically (`ITMS-91053: Missing API declaration`), before a human ever looks at it.
 *
 * - **FileTimestamp** (`C617.1`) — `tauri-plugin-store` writes and stats the vault file. This
 *   is the one that changed when storage moved off `UserDefaults`; see `src/lib/storage.ts`.
 * - **UserDefaults** (`CA92.1`) — the Tauri iOS runtime still touches it, and declaring a
 *   category the app does not use is harmless where omitting one it does use is an automatic
 *   rejection. The asymmetry is the whole argument for keeping it.
 *
 * `NSPrivacyTracking` is false and the collected-data list is empty because the WALLET
 * collects nothing on its own behalf. The fiat on/off-ramp does transmit identity data to a
 * third party, but that flows to CosmosPay's own service under its own disclosure; if that
 * ever becomes first-party collection, `NSPrivacyCollectedDataTypes` has to say so here too.
 */
const IOS_PRIVACY_MANIFEST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Generated by scripts/native-permissions.ts — src-tauri/gen/ is a build output. -->
<plist version="1.0">
<dict>
\t<key>NSPrivacyTracking</key>
\t<false/>
\t<key>NSPrivacyTrackingDomains</key>
\t<array/>
\t<key>NSPrivacyCollectedDataTypes</key>
\t<array/>
\t<key>NSPrivacyAccessedAPITypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>NSPrivacyAccessedAPIType</key>
\t\t\t<string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
\t\t\t<key>NSPrivacyAccessedAPITypeReasons</key>
\t\t\t<array>
\t\t\t\t<string>C617.1</string>
\t\t\t</array>
\t\t</dict>
\t\t<dict>
\t\t\t<key>NSPrivacyAccessedAPIType</key>
\t\t\t<string>NSPrivacyAccessedAPICategoryUserDefaults</string>
\t\t\t<key>NSPrivacyAccessedAPITypeReasons</key>
\t\t\t<array>
\t\t\t\t<string>CA92.1</string>
\t\t\t</array>
\t\t</dict>
\t</array>
</dict>
</plist>
`;

async function patchIosPrivacyManifest(): Promise<void> {
  if (!IOS_PLIST || !(await exists(IOS_PLIST))) return; // patchIos() already said so

  await writeFile(IOS_PRIVACY_MANIFEST, IOS_PRIVACY_MANIFEST_XML);
  log(`${IOS_PRIVACY_MANIFEST} written.`);

  // Writing the file is not enough: it only ships if it is a member of the App target's
  // "Copy Bundle Resources" phase, and that lives in project.pbxproj — a format this script
  // will not edit blind, because a malformed pbxproj breaks the whole Xcode project rather
  // than one feature. So: check, and keep saying so on every sync until a human does it.
  const pbxproj = IOS_PBXPROJ && (await exists(IOS_PBXPROJ)) ? await readFile(IOS_PBXPROJ, 'utf8') : '';
  if (!pbxproj.includes('PrivacyInfo.xcprivacy')) {
    log('ACTION REQUIRED — add PrivacyInfo.xcprivacy to the app target in Xcode');
    log(`  (drag ${IOS_PRIVACY_MANIFEST} into the app group, tick the app target).`);
    log('  Without it the file is not in the bundle and App Store Connect rejects the upload');
    log('  with ITMS-91053: Missing API declaration.');
  }
}

/**
 * The half of the backup story this script CANNOT write, said out loud on every sync.
 *
 * `patchAndroidBackup` keeps the sealed vault off Google Drive with three mechanisms and a
 * paragraph explaining why a non-custodial wallet's storage must not leave the device. iOS
 * has no manifest equivalent to write: `NSURLIsExcludedFromBackupKey` is a resource value
 * set on a URL at runtime, so the exclusion is code — the `exclude_from_backup` command in
 * `src-tauri/plugins/cosmos/src/mobile.rs`, whose Swift half sets the flag on the app-data
 * DIRECTORY, called once per launch by `src/lib/storage.ts` before the store file exists.
 *
 * What used to restore onto a different device, and would again if that call stopped
 * happening: `cosmos.w.<id>`, the AES-GCM sealed seed and mnemonic, grindable offline at
 * the attacker's own pace — plus `cosmos.wallets` in the clear: name, email, birthdate,
 * gender, avatar.
 *
 * The device-unlock envelope is the one part that does NOT travel: its wrapping key is a
 * Keychain item written `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` with
 * `.biometryCurrentSet`, so the restored copy opens nothing. The vault beside it is the
 * part that needed this.
 *
 * Why this still prints: the Swift half is compiled only on a Mac and executed only on a
 * phone, and nothing in CI does either — the same reason CLAUDE.md says to treat a change
 * to `DeviceAuth.swift` as untested until someone has unlocked a real device with it. "The
 * code exists" and "the flag is set on that phone" are different claims.
 */
async function reportIosBackupCheck(): Promise<void> {
  if (!IOS_PLIST || !(await exists(IOS_PLIST))) return; // patchIos() already said so
  log('VERIFY ON A DEVICE — iOS backup exclusion is code, not configuration.');
  log('  src-tauri/plugins/cosmos/ios/Sources/CosmosPlugin/CosmosPlugin.swift sets');
  log('  NSURLIsExcludedFromBackupKey on the app-data directory; src/lib/storage.ts calls');
  log('  it once per launch, before the store file is created. Android is covered by');
  log('  allowBackup=false + dataExtractionRules and needs no code at all.');
  log('  Check on a device: the app-data directory must be absent from a fresh backup.');
}

await patchAndroid();
await patchAndroidBackup();
await patchIos();
await patchIosPrivacyManifest();
await reportIosBackupCheck();
