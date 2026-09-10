/**
 * Cosmos Wallet — web provider (no extension required).
 *
 * A site includes this from the wallet's own origin:
 *
 *   <script src="https://<wallet-host>/cosmos-wallet.js"></script>
 *
 * and gets `window.cosmosWallet`, the same SEP-43-style interface the browser
 * extension injects. It has no access to keys and never sees a password: every call
 * opens the wallet's approval window, the user unlocks and approves there, and only the
 * result comes back — over postMessage, on this page's exact origin.
 *
 * API (all async, all return Promises):
 *   cosmosWallet.getAddress()                 -> { address, network, networkPassphrase, networkUrl }
 *   cosmosWallet.connect()                    -> alias of getAddress()
 *   cosmosWallet.getNetwork()                 -> { network, networkPassphrase, networkUrl }
 *   cosmosWallet.getNetworkDetails()          -> alias of getNetwork()
 *   cosmosWallet.signTransaction(xdr, opts?)  -> { signedTxXdr, signerAddress, … }
 *   cosmosWallet.signMessage(message, opts?)  -> { signedMessage, signerAddress, domain, … }
 *   cosmosWallet.requestPayment(sep7Uri)      -> { hash, signerAddress, … }   (web+stellar:pay…)
 *   cosmosWallet.isConnected()                -> boolean   (a hint; see below)
 *   cosmosWallet.disconnect()                 -> forgets what this page cached
 *
 * CALL IT FROM A CLICK. Every method above opens a window, and a browser only allows
 * that inside a user gesture. Called from a timer or on load it will be blocked, and
 * the promise rejects saying so — it does not hang.
 *
 * IF THE EXTENSION IS INSTALLED it wins: it injects the same global at document_start
 * and this script leaves it alone. A page written against either works against both.
 *
 * `isConnected()` and a `getNetwork()` that answers without a window read what a
 * previous reply told THIS page, kept in sessionStorage. They are hints — the user can
 * revoke the site or switch network in the wallet without this page hearing about it.
 * `getAddress()` never uses them: it always asks, so the address a page acts on is the
 * one the wallet holds right now. Every signing reply also carries `signerAddress`,
 * which is the authoritative answer to "who signed this".
 *
 * The four wire literals below are the ones `src/constants/dapp.ts` declares; the
 * approval window is the other end of them (src/lib/webSigner.ts).
 * `tests/unit/webSigner.test.ts` compares the two files so a rename cannot land in one
 * of them alone.
 */
(() => {
  if (window.cosmosWallet) return; // the extension's provider is already here

  const TARGET = 'cosmos-wallet';
  const PROTOCOL = 1;
  const PARAM = { flag: 'web', nonce: 'n', origin: 'o' };

  const SELF = (document.currentScript && document.currentScript.src) || '';
  if (!SELF) return; // loaded in a way that hides its own URL: there is no wallet to talk to
  const WALLET_ORIGIN = new URL(SELF).origin;
  const APPROVE_URL = new URL('approve/', SELF).href;
  const CACHE_KEY = 'cosmos.wallet.web.' + WALLET_ORIGIN;

  // Approvals wait on a human: unlocking and reading a transaction takes as long as it
  // takes. This is the backstop that guarantees the promise settles at all — closing
  // the window settles it far sooner, and so does the wallet answering.
  const TIMEOUT_MS = 5 * 60_000;
  const CLOSED_POLL_MS = 400;

  let seq = 0;

  const readCache = () => {
    try {
      return JSON.parse(sessionStorage.getItem(CACHE_KEY) || '{}') || {};
    } catch {
      return {};
    }
  };
  const writeCache = (patch) => {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ...readCache(), ...patch }));
    } catch {
      /* private mode, or storage disabled — the provider works without it */
    }
  };

  function nonce() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return [...b].map((n) => n.toString(36)).join('').slice(0, 24);
  }

  /** Centre the window on the screen the page is on, not on screen 0. */
  function features() {
    const w = 430;
    const h = 680;
    const left = Math.max(0, (window.screenX || 0) + ((window.outerWidth || w) - w) / 2);
    const top = Math.max(0, (window.screenY || 0) + ((window.outerHeight || h) - h) / 3);
    return `popup=yes,width=${w},height=${h},left=${Math.round(left)},top=${Math.round(top)}`;
  }

  /**
   * Open the approval window and settle when it answers.
   *
   * The window announces itself repeatedly until it is answered, so a `ready` that
   * arrives before this listener is attached is not a lost request; every `ready` for
   * this nonce re-sends the same id, and the wallet acts on the first one only.
   */
  function request(method, params) {
    return new Promise((resolve, reject) => {
      const n = nonce();
      const id = `${Date.now()}.${seq++}`;
      const url = `${APPROVE_URL}?${PARAM.flag}=1&${PARAM.nonce}=${n}&${PARAM.origin}=${encodeURIComponent(location.origin)}`;
      const win = window.open(url, `cosmos-wallet-${n}`, features());
      if (!win) {
        reject(new Error('Cosmos Wallet: the approval window was blocked. Allow pop-ups for this site, and call the wallet from a click.'));
        return;
      }

      let settled = false;
      const finish = (err, result) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        clearInterval(watch);
        clearTimeout(timer);
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve(result);
      };

      const onMessage = (ev) => {
        if (ev.origin !== WALLET_ORIGIN || ev.source !== win) return;
        const d = ev.data;
        if (!d || typeof d !== 'object' || d.target !== TARGET || d.protocol !== PROTOCOL) return;
        if (d.type === 'ready' && d.nonce === n) {
          win.postMessage({ target: TARGET, type: 'request', protocol: PROTOCOL, nonce: n, id, method, params: params || {} }, WALLET_ORIGIN);
          return;
        }
        if (d.type !== 'result' || d.id !== id) return;
        if (!d.ok) {
          finish(new Error(d.error || 'Rejected.'));
          return;
        }
        const r = d.result || {};
        // Every reply carries the wallet's current network; a connect also proves the
        // site is granted. That is all this page is allowed to remember.
        if (r.networkPassphrase) {
          writeCache({ network: r.network, networkPassphrase: r.networkPassphrase, networkUrl: r.networkUrl });
        }
        if (method === 'getAddress' && r.address) writeCache({ connected: true });
        finish(null, r);
      };

      window.addEventListener('message', onMessage);
      // The user closing the window is an answer: reject now rather than at the timeout.
      const watch = setInterval(() => {
        if (win.closed) finish(new Error('The user closed the approval window.'));
      }, CLOSED_POLL_MS);
      const timer = setTimeout(() => {
        try {
          win.close();
        } catch {
          /* already gone */
        }
        finish(new Error('Cosmos Wallet: no answer from the approval window (timed out).'));
      }, TIMEOUT_MS);
    });
  }

  const api = {
    isCosmosWallet: true,
    id: 'cosmos',
    name: 'Cosmos Wallet',
    /** 'web' here, absent on the extension's provider — a page can tell them apart. */
    transport: 'web',
    async isConnected() {
      return !!readCache().connected;
    },
    async getAddress() {
      return request('getAddress');
    },
    async connect() {
      return request('getAddress');
    },
    async getNetwork() {
      const c = readCache();
      if (c.networkPassphrase) return { network: c.network, networkPassphrase: c.networkPassphrase, networkUrl: c.networkUrl };
      const r = await request('getAddress');
      return { network: r.network, networkPassphrase: r.networkPassphrase, networkUrl: r.networkUrl };
    },
    async getNetworkDetails() {
      return api.getNetwork();
    },
    async signTransaction(xdr, opts) {
      return request('signTransaction', { xdr, ...(opts || {}) });
    },
    async signMessage(message, opts) {
      return request('signMessage', { message, ...(opts || {}) });
    },
    // SEP-7 payment link (web+stellar:pay…): the wallet parses, signs & submits it.
    async requestPayment(uri) {
      return request('requestPayment', { uri });
    },
    /** Forget this page's cache. It does not revoke the grant — Settings does that. */
    async disconnect() {
      try {
        sessionStorage.removeItem(CACHE_KEY);
      } catch {
        /* nothing cached */
      }
    },
  };

  Object.defineProperty(window, 'cosmosWallet', { value: Object.freeze(api), writable: false, configurable: false });
  window.dispatchEvent(new Event('cosmosWallet#initialized'));
})();
