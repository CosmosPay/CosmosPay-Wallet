/**
 * The web transport's admission rules.
 *
 * This is the module that decides whether a message arriving at the approval window is
 * a request from the site the user just left, or from anything else at all. On the
 * extension that question is answered by the browser — a content script stamps the
 * origin and the page cannot reach the service worker directly. Hosted as a page, the
 * wallet has to answer it itself, so every one of these cases is a door:
 *
 *   not the opener            any window that got a handle to this one
 *   an origin that disagrees  with the one the handshake was opened for
 *   the wrong nonce           a stale window, or a guessed one
 *   `'null'` as an origin     a sandboxed frame, a data: document, a file:// page
 *   params that do not fit    "sign this" with nothing to sign
 *
 * Every refusal is silence (null), never a reply: answering a sender that failed a
 * check is the leak the checks exist to prevent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readWebRequest,
  readyMessage,
  resultMessage,
  webSignerContext,
  type IncomingMessage,
  type WebSignerContext,
} from '@/lib/webSigner';
import {
  MAX_MESSAGE_CHARS,
  MAX_XDR_CHARS,
  WEB_SIGNER_PARAM,
  WEB_SIGNER_PROTOCOL,
  WEB_SIGNER_TARGET,
} from '@/constants/dapp';

const NONCE = 'abc123def456ghi789jk';
const DAPP = 'https://dapp.example';
const CTX: WebSignerContext = { nonce: NONCE, origin: DAPP };
const WALLET = 'https://wallet.example/approve/';

const url = (q: string) => `${WALLET}?${q}`;
const handshake = `${WEB_SIGNER_PARAM.flag}=1&${WEB_SIGNER_PARAM.nonce}=${NONCE}&${WEB_SIGNER_PARAM.origin}=${encodeURIComponent(DAPP)}`;

/** A well-formed request, which each test then breaks in exactly one way. */
function message(over: Record<string, unknown> = {}, msg: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    data: {
      target: WEB_SIGNER_TARGET,
      type: 'request',
      protocol: WEB_SIGNER_PROTOCOL,
      nonce: NONCE,
      id: 'req-1',
      method: 'signTransaction',
      params: { xdr: 'AAAAAgAAAAB' },
      ...over,
    },
    origin: DAPP,
    fromOpener: true,
    ...msg,
  };
}

/* --------------------------------- the URL -------------------------------- */

test('the handshake is read from the window URL', () => {
  assert.deepEqual(webSignerContext(url(handshake)), { nonce: NONCE, origin: DAPP });
});

test('no web flag means no web handshake — that window belongs to the extension', () => {
  assert.equal(webSignerContext(`${WALLET}?req=8b1c-…`), null);
  assert.equal(webSignerContext(WALLET), null);
});

test('a URL that names no usable origin is not a handshake', () => {
  const withOrigin = (o: string) =>
    url(`${WEB_SIGNER_PARAM.flag}=1&${WEB_SIGNER_PARAM.nonce}=${NONCE}&${WEB_SIGNER_PARAM.origin}=${encodeURIComponent(o)}`);
  // 'null' is what a sandboxed frame or a data: document is stamped with. It names no
  // site, so it can neither be shown to a user nor granted.
  assert.equal(webSignerContext(withOrigin('null')), null);
  assert.equal(webSignerContext(withOrigin('file://')), null);
  assert.equal(webSignerContext(withOrigin('javascript:alert(1)')), null);
  // An origin is a scheme and a host, nothing more: a path means it was built by hand.
  assert.equal(webSignerContext(withOrigin('https://dapp.example/app')), null);
});

test('a nonce outside the alphabet or the length is not a handshake', () => {
  const withNonce = (n: string) =>
    url(`${WEB_SIGNER_PARAM.flag}=1&${WEB_SIGNER_PARAM.nonce}=${n}&${WEB_SIGNER_PARAM.origin}=${encodeURIComponent(DAPP)}`);
  assert.equal(webSignerContext(withNonce('short')), null);
  assert.equal(webSignerContext(withNonce('a'.repeat(200))), null);
  assert.equal(webSignerContext(withNonce('has spaces here!!')), null);
});

/* ------------------------------- the request ------------------------------ */

test('a well-formed request from the opener is accepted, on the browser-stamped origin', () => {
  const req = readWebRequest(message(), CTX);
  assert.equal(req?.method, 'signTransaction');
  assert.equal(req?.id, 'req-1');
  assert.equal(req?.params.xdr, 'AAAAAgAAAAB');
  assert.equal(req?.origin, DAPP);
});

test('a message from anything but the opener is ignored', () => {
  assert.equal(readWebRequest(message({}, { fromOpener: false }), CTX), null);
});

test('an origin that is not the one the window was opened for is ignored', () => {
  // The whole point: `ctx.origin` came off the URL, `msg.origin` off the browser. A
  // page that opens the wallet claiming to be someone else fails here, because the
  // browser stamp is what it cannot write.
  assert.equal(readWebRequest(message({}, { origin: 'https://evil.example' }), CTX), null);
  assert.equal(readWebRequest(message({}, { origin: 'null' }), CTX), null);
  assert.equal(readWebRequest(message({}, { origin: '' }), CTX), null);
});

test('the nonce must be the one this window was opened with', () => {
  assert.equal(readWebRequest(message({ nonce: 'zzz123def456ghi789jk' }), CTX), null);
  assert.equal(readWebRequest(message({ nonce: undefined }), CTX), null);
});

test('the envelope must be ours, and this protocol version', () => {
  assert.equal(readWebRequest(message({ target: 'metamask-inpage' }), CTX), null);
  assert.equal(readWebRequest(message({ type: 'ready' }), CTX), null);
  assert.equal(readWebRequest(message({ protocol: WEB_SIGNER_PROTOCOL + 1 }), CTX), null);
  assert.equal(readWebRequest({ data: 'not an object', origin: DAPP, fromOpener: true }, CTX), null);
  assert.equal(readWebRequest({ data: null, origin: DAPP, fromOpener: true }, CTX), null);
});

test('only the four methods the window can serve are admitted', () => {
  for (const method of ['getAddress', 'signMessage', 'requestPayment']) {
    const params = method === 'signMessage' ? { message: 'hello' } : method === 'requestPayment' ? { uri: 'web+stellar:pay?destination=G…' } : {};
    assert.equal(readWebRequest(message({ method, params }), CTX)?.method, method);
  }
  // `signAuthEntry`, `getNetwork` and friends: not implemented is not "pass it through".
  assert.equal(readWebRequest(message({ method: 'signAuthEntry' }), CTX), null);
  assert.equal(readWebRequest(message({ method: 'getNetwork' }), CTX), null);
  assert.equal(readWebRequest(message({ method: '' }), CTX), null);
});

test('a request must carry what its method needs, within the caps', () => {
  // "Sign this" with nothing to sign used to be representable, and what it produced
  // downstream was an approval window offering to sign the empty string.
  assert.equal(readWebRequest(message({ params: {} }), CTX), null);
  assert.equal(readWebRequest(message({ params: { xdr: '' } }), CTX), null);
  assert.equal(readWebRequest(message({ params: { xdr: 42 } }), CTX), null);
  assert.equal(readWebRequest(message({ params: { xdr: 'A'.repeat(MAX_XDR_CHARS + 1) } }), CTX), null);
  assert.ok(readWebRequest(message({ params: { xdr: 'A'.repeat(MAX_XDR_CHARS) } }), CTX));

  assert.equal(readWebRequest(message({ method: 'signMessage', params: { message: '' } }), CTX), null);
  assert.equal(
    readWebRequest(message({ method: 'signMessage', params: { message: 'm'.repeat(MAX_MESSAGE_CHARS + 1) } }), CTX),
    null,
  );

  // A payment link is a SEP-7 link or it is not a payment link.
  assert.equal(readWebRequest(message({ method: 'requestPayment', params: { uri: 'https://example.com/pay' } }), CTX), null);
  assert.ok(readWebRequest(message({ method: 'requestPayment', params: { uri: 'WEB+STELLAR:pay?destination=G…' } }), CTX));
});

test('an id is required, and stays short enough to echo back', () => {
  assert.equal(readWebRequest(message({ id: '' }), CTX), null);
  assert.equal(readWebRequest(message({ id: 7 }), CTX), null);
  assert.equal(readWebRequest(message({ id: 'x'.repeat(500) }), CTX), null);
});

test('the passphrase a dapp states is carried, never used as the one signed against', () => {
  // The window compares it with the wallet's own and refuses a mismatch (ApprovePopup);
  // what must not happen is it disappearing here, which would make every request look
  // like one that named no network at all.
  const req = readWebRequest(message({ params: { xdr: 'AAAA', networkPassphrase: 'Public Global Stellar Network ; September 2015' } }), CTX);
  assert.equal(req?.params.networkPassphrase, 'Public Global Stellar Network ; September 2015');
  assert.equal(readWebRequest(message({ params: { xdr: 'AAAA', networkPassphrase: 'x'.repeat(300) } }), CTX), null);
});

/* -------------------------------- the replies ------------------------------ */

test('the ready announcement carries no wallet state', () => {
  const ready = readyMessage(CTX);
  assert.deepEqual(ready, { target: WEB_SIGNER_TARGET, type: 'ready', protocol: WEB_SIGNER_PROTOCOL, nonce: NONCE });
  // It is posted before anyone has been identified, so it must say nothing about the
  // wallet: no address, no network, not whether a wallet exists at all.
  assert.equal(JSON.stringify(ready).includes('address'), false);
});

test('a result is tagged with the id the dapp chose', () => {
  const req = readWebRequest(message(), CTX)!;
  assert.deepEqual(resultMessage(req, true, { signedTxXdr: 'AAA' }), {
    target: WEB_SIGNER_TARGET,
    type: 'result',
    protocol: WEB_SIGNER_PROTOCOL,
    id: 'req-1',
    ok: true,
    result: { signedTxXdr: 'AAA' },
    error: undefined,
  });
  const refused = resultMessage(req, false, undefined, 'Rejected by the user.');
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'Rejected by the user.');
});

/* ------------------------- the two ends of the wire ------------------------ */

test('the provider script speaks the same wire as the window it opens', () => {
  // `public/cosmos-wallet.js` is served to dapps as a plain file: no bundler, no
  // imports, so it holds its own copy of these four literals — the same arrangement
  // `extension-src/sw.js` has with the mirror key. Nothing in either toolchain
  // compares them, and a rename that lands in one file alone does not fail a build:
  // it produces a wallet window that waits for a request no dapp will ever send.
  const provider = readFileSync(join(import.meta.dirname, '..', '..', 'public', 'cosmos-wallet.js'), 'utf8');
  assert.match(provider, new RegExp(`const TARGET = '${WEB_SIGNER_TARGET}';`));
  assert.match(provider, new RegExp(`const PROTOCOL = ${WEB_SIGNER_PROTOCOL};`));
  assert.match(
    provider,
    new RegExp(`const PARAM = \\{ flag: '${WEB_SIGNER_PARAM.flag}', nonce: '${WEB_SIGNER_PARAM.nonce}', origin: '${WEB_SIGNER_PARAM.origin}' \\};`),
  );
  // It must open the page the wallet actually serves the approval window from.
  assert.match(provider, /new URL\('approve\/', SELF\)/);
});
