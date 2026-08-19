/**
 * Correct the Keystore auth-type constants in @capgo/capacitor-native-biometric.
 *
 * Wired to `postinstall`, because Gradle compiles this plugin's Java straight out of
 * node_modules — there is no copy under android/ to patch instead, and `npm ci` in CI
 * restores the broken original every run.
 *
 * THE BUG. `android.security.keystore.KeyProperties` defines:
 *
 *     AUTH_DEVICE_CREDENTIAL = 1 << 0   ->  1
 *     AUTH_BIOMETRIC_STRONG  = 1 << 1   ->  2
 *
 * The plugin mirrors those by hand in AuthActivity.java and BiometricAuthenticatorConfig.java
 * ("Mirrors KeyProperties auth-type flags when older compile stubs omit symbols") and gets
 * every value wrong: STRONG=1, WEAK=2, DEVICE_CREDENTIAL=4. So `KEY_AUTH_BIOMETRIC_STRONG`
 * is really AUTH_DEVICE_CREDENTIAL, and `KEY_AUTH_BIOMETRIC_WEAK` is really
 * AUTH_BIOMETRIC_STRONG. NativeBiometric.java:965 uses the real `KeyProperties.AUTH_BIOMETRIC_STRONG`
 * for an unrelated key, which is what shows these are a mistake rather than a convention.
 *
 * WHAT IT BREAKS. `buildCredentialKey` calls `setUserAuthenticationParameters(0, authTypes)`
 * with authTypes = KEY_AUTH_BIOMETRIC_STRONG = 1, so on API 30+ every crypto-bound key is
 * created demanding a DEVICE-CREDENTIAL auth token. The BiometricPrompt beside it is built
 * with `setAllowedAuthenticators(BIOMETRIC_STRONG)`, so the user authenticates with a
 * fingerprint and the Keystore gets a biometric token it will not accept. `cipher.doFinal`
 * then fails with KM_ERROR_KEY_USER_NOT_AUTHENTICATED, which AOSP surfaces as a
 * message-less `IllegalBlockSizeException` — reaching the user as the uninformative
 * "Failed to encrypt credentials: null". Every device on API 30 or newer is affected, which
 * is why this looked like a device quirk rather than a total failure of `setData`.
 *
 * There is no JS-side workaround: `setData` never forwards `allowedBiometryTypes`, and for
 * crypto-bound storage `ensureCryptoCompatible` overrides the config with
 * `defaultForCryptoBoundCredentials()` anyway, so the wrong constant is always the one used.
 *
 * Idempotent, and quiet when the plugin is absent. `tests/unit/nativeBiometric.test.ts`
 * asserts the result, so a plugin upgrade that reinstates the originals fails CI instead of
 * silently disabling biometric unlock again.
 */
import { access, readFile, writeFile } from 'node:fs/promises';

const PLUGIN_JAVA = 'node_modules/@capgo/capacitor-native-biometric/android/src/main/java/ee/forgr/biometric';

/** The files that declare their own copies of the flags. */
const TARGETS = [`${PLUGIN_JAVA}/AuthActivity.java`, `${PLUGIN_JAVA}/BiometricAuthenticatorConfig.java`];

/**
 * The values `android.security.keystore.KeyProperties` actually uses.
 *
 * WEAK is 0 and that is not a placeholder: Keystore has no Class-2 auth-type flag at all,
 * because a weak biometric may not back a hardware key. 0 is the identity for the `|` these
 * constants are combined with, so `keyAuthAny()` correctly reduces to STRONG alone.
 */
const CORRECT: { name: string; value: number; why: string }[] = [
  { name: 'KEY_AUTH_BIOMETRIC_STRONG', value: 2, why: 'KeyProperties.AUTH_BIOMETRIC_STRONG = 1 << 1' },
  { name: 'KEY_AUTH_BIOMETRIC_WEAK', value: 0, why: 'no Keystore flag exists for Class 2 biometrics' },
  { name: 'KEY_AUTH_DEVICE_CREDENTIAL', value: 1, why: 'KeyProperties.AUTH_DEVICE_CREDENTIAL = 1 << 0' },
];

const log = (msg: string) => console.log(`patch:biometric — ${msg}`);

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function patch(file: string): Promise<void> {
  if (!(await exists(file))) {
    log(`no ${file}, skipping.`);
    return;
  }

  const before = await readFile(file, 'utf8');
  let after = before;
  const missing: string[] = [];

  for (const { name, value, why } of CORRECT) {
    // Rewrite the WHOLE declaration line to a canonical form, rather than substituting the
    // literal in place. Substituting appends a fresh trailing comment on every run, so a
    // second `npm ci` would stack them; rewriting the line makes re-running a true no-op,
    // which is what lets `after === before` be the test for "already correct".
    //
    // Anchored on the declaration and not on the wrong value, so a plugin that renamed or
    // removed the constant is reported instead of silently left unpatched.
    const decl = new RegExp(`^([ \\t]*)private static final int ${name}\\s*=\\s*-?\\d+\\s*;.*$`, 'm');
    if (!decl.test(after)) {
      missing.push(name);
      continue;
    }
    after = after.replace(decl, `$1private static final int ${name} = ${value}; // patched: ${why}`);
  }

  if (missing.length) {
    log(`WARNING — ${file} no longer declares: ${missing.join(', ')}.`);
    log('  The plugin changed shape. Re-check the Keystore auth-type flags by hand before');
    log('  trusting biometric unlock — tests/unit/nativeBiometric.test.ts will fail until then.');
  }

  if (after === before) {
    log(`${file} already correct.`);
    return;
  }
  await writeFile(file, after);
  log(`${file} patched.`);
}

for (const file of TARGETS) await patch(file);
