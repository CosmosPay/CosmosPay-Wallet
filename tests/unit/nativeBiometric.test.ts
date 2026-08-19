/**
 * The vendored plugin's Keystore auth-type constants are the ones Android actually uses.
 *
 * This guards a fact about node_modules rather than a function, in the style of
 * `paths.test.ts`, because the failure it catches is silent: @capgo/capacitor-native-biometric
 * declares its own copies of `KeyProperties`' auth-type flags and every value is wrong —
 * `KEY_AUTH_BIOMETRIC_STRONG = 1` is really `AUTH_DEVICE_CREDENTIAL`. `buildCredentialKey`
 * then creates every crypto-bound key demanding a PIN, while the `BiometricPrompt` beside it
 * only accepts a fingerprint, so `cipher.doFinal` fails with
 * KM_ERROR_KEY_USER_NOT_AUTHENTICATED — which AOSP throws as a message-less
 * `IllegalBlockSizeException` and the app reports as "Failed to encrypt credentials: null".
 * Enrolment is impossible on every device running API 30 or newer.
 *
 * `scripts/patch-native-biometric.ts` fixes it from `postinstall`. A plugin upgrade restores
 * the broken originals, and nothing in a web build would notice: the whole failure lives on
 * a phone, behind a biometric prompt, and the previous design hid it by silently falling back
 * to storing the wrapping key UNBOUND. So it is asserted here, where CI runs it after
 * `npm ci`, instead of being discovered again by a user with a locked wallet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PLUGIN_JAVA = join(
  import.meta.dirname,
  '..',
  '..',
  'node_modules',
  '@capgo',
  'capacitor-native-biometric',
  'android',
  'src',
  'main',
  'java',
  'ee',
  'forgr',
  'biometric',
);

/** android.security.keystore.KeyProperties. WEAK is 0 because Keystore has no Class-2 flag. */
const EXPECTED: Record<string, number> = {
  KEY_AUTH_BIOMETRIC_STRONG: 2, // AUTH_BIOMETRIC_STRONG = 1 << 1
  KEY_AUTH_BIOMETRIC_WEAK: 0, // no such flag — a weak biometric may not back a hardware key
  KEY_AUTH_DEVICE_CREDENTIAL: 1, // AUTH_DEVICE_CREDENTIAL = 1 << 0
};

const FILES = ['AuthActivity.java', 'BiometricAuthenticatorConfig.java'];

for (const file of FILES) {
  test(`${file} declares the real KeyProperties auth-type values`, () => {
    const path = join(PLUGIN_JAVA, file);
    // Not an error: the plugin is an optional native dependency and a checkout that never
    // installed it has nothing to guard. `npm ci` in CI does install it, which is where this
    // assertion has to hold.
    if (!existsSync(path)) return;

    const src = readFileSync(path, 'utf8');
    for (const [name, value] of Object.entries(EXPECTED)) {
      const found = new RegExp(`private static final int ${name}\\s*=\\s*(-?\\d+)\\s*;`).exec(src);
      assert.ok(found, `${file} no longer declares ${name} — re-check the flags by hand`);
      assert.equal(
        Number(found[1]),
        value,
        `${file}: ${name} is ${found[1]}, expected ${value}. Run \`npm run postinstall\` (scripts/patch-native-biometric.ts). If a plugin upgrade fixed this upstream, delete the patch instead of widening this test.`,
      );
    }
  });
}
