/**
 * Write the two files that let the Android and iOS apps use passkeys for `cosmospay.lat`.
 *
 *   APPLE_TEAM_ID=ABCDE12345 \
 *   ANDROID_CERT_SHA256=AA:BB:…,CC:DD:… \
 *   npm run passkey:well-known            # -> dist/well-known/.well-known/*
 *
 * A passkey belongs to a domain (its relying party, `PASSKEY_RP_ID`), and an OS lets an APP
 * use one only when that domain says the app may. The web build needs nothing — it IS the
 * domain — but the apps are strangers to it until the domain serves:
 *
 *  - `/.well-known/assetlinks.json`, naming the Android package and the SHA-256 of every
 *    certificate that signs it (the release key, the upload/debug keys you test with, and —
 *    with Play App Signing — Google's key, from Play Console → App integrity). Credential
 *    Manager checks it on every ceremony; without it the answer is a SecurityError.
 *  - `/.well-known/apple-app-site-association`, naming `<TEAM_ID>.<bundle id>` under
 *    `webcredentials`. iOS fetches it through Apple's CDN when the app is installed, and
 *    the app must also carry the `webcredentials:` entitlement (`scripts/native-permissions.ts`).
 *
 * Both must be served from `https://cosmospay.lat/.well-known/` — the relying party itself,
 * not a subdomain — over HTTPS with no redirect, the AASA file with `Content-Type:
 * application/json` and no extension. Which server that is lives outside this repository;
 * this script only writes the files, so what gets deployed is generated from the same
 * identifiers the app is built with rather than typed by hand.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PASSKEY_RP_ID } from '../src/constants/passkey.ts';

const OUT = 'dist/well-known/.well-known';

const conf = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8')) as { identifier?: string };
const bundleId = conf.identifier;
if (!bundleId) throw new Error('src-tauri/tauri.conf.json has no identifier');

const team = (process.env.APPLE_TEAM_ID ?? '').trim();
const certs = (process.env.ANDROID_CERT_SHA256 ?? '')
  .split(',')
  .map((c) => c.trim().toUpperCase())
  .filter(Boolean);

const problems: string[] = [];
if (!/^[A-Z0-9]{10}$/.test(team)) problems.push('APPLE_TEAM_ID must be the 10-character Apple team id');
if (!certs.length) problems.push('ANDROID_CERT_SHA256 must list at least one certificate fingerprint');
for (const c of certs) {
  if (!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(c)) problems.push(`not a SHA-256 fingerprint (AA:BB:… x32): ${c}`);
}
if (problems.length) {
  console.error('passkey:well-known — ' + problems.join('\n  '));
  process.exit(1);
}

/**
 * `get_login_creds` is the relation passkeys (and saved passwords) need. `handle_all_urls`
 * is App Links, which this app does not claim — asking for it would make Android try to
 * open every cosmospay.lat link in the wallet.
 */
const assetlinks = [
  {
    relation: ['delegate_permission/common.get_login_creds'],
    target: { namespace: 'android_app', package_name: bundleId, sha256_cert_fingerprints: certs },
  },
];

/** `webcredentials` only: passkeys and passwords, not universal links. */
const aasa = { webcredentials: { apps: [`${team}.${bundleId}`] } };

await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}/assetlinks.json`, JSON.stringify(assetlinks, null, 2) + '\n');
await writeFile(`${OUT}/apple-app-site-association`, JSON.stringify(aasa, null, 2) + '\n');
console.log(`passkey:well-known — wrote ${OUT}/assetlinks.json and ${OUT}/apple-app-site-association`);
console.log(`  serve both from https://${PASSKEY_RP_ID}/.well-known/ (HTTPS, no redirect, application/json)`);
