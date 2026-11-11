/**
 * Cosmos Wallet — in-page provider (runs in the web page's MAIN world).
 *
 * Exposes two providers. Neither has access to keys: every call is forwarded (via postMessage)
 * to the content script, then to the extension, where the user approves and signs.
 *
 * 1. `window.cosmosWallet`, a SEP-43-style Stellar wallet interface (all async):
 *   cosmosWallet.getAddress()                 -> { address }
 *   cosmosWallet.getNetwork()                 -> { network, networkPassphrase, networkUrl }
 *   cosmosWallet.getNetworkDetails()          -> alias of getNetwork()
 *   cosmosWallet.signTransaction(xdr, opts?)  -> { signedTxXdr, signerAddress }
 *   cosmosWallet.signMessage(message, opts?)  -> { signedMessage, signerAddress }
 *   cosmosWallet.requestPayment(sep7Uri)      -> { hash, signerAddress }   (web+stellar:pay…)
 *   cosmosWallet.isConnected()                -> boolean
 *
 * 2. An EIP-1193 provider for the wallet's 0x account, announced with EIP-6963
 *    (`eip6963:announceProvider`, rdns `lat.cosmospay.wallet`) and set as `window.ethereum`
 *    only when no other wallet already is. `request({ method, params })`, `on`,
 *    `removeListener`; events `connect`, `chainChanged`, `accountsChanged`. What it may ask
 *    for is decided by the service worker (extension-src/sw.js, "EVM").
 */
(() => {
  if (window.cosmosWallet) return;

  const pending = new Map();
  let seq = 0;

  // Everything downstream (sw.js parking replies, content.js resuming on reconnect)
  // is a best-effort recovery path, not a guarantee. This timeout is the guarantee:
  // a dapp promise must always settle eventually. Approval methods wait on the user
  // (typing a password can take a while), so they get a generous budget; read-only
  // methods should answer almost instantly, so a short timeout catches real breakage.
  const TIMEOUT_MS = { getNetwork: 15_000, isConnected: 15_000 };
  const DEFAULT_TIMEOUT_MS = 5 * 60_000;

  /** An EIP-1193 error: an Error carrying `code` (and `data` when the node sent some). */
  function rpcError(e) {
    const err = new Error(e && e.message ? String(e.message) : 'Cosmos Wallet: request failed.');
    err.code = e && typeof e.code === 'number' ? e.code : -32603;
    if (e && e.data !== undefined) err.data = e.data;
    return err;
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.target !== 'cosmos-inpage' || d.id == null) return;
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    // The Stellar provider's errors are strings; the EVM provider's are { code, message }.
    if (d.error) p.reject(typeof d.error === 'object' ? rpcError(d.error) : new Error(d.error));
    else p.resolve(d.result);
  });

  function request(method, params) {
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}.${seq++}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Cosmos Wallet: no response from the extension (timed out).'));
      }, TIMEOUT_MS[method] ?? DEFAULT_TIMEOUT_MS);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      window.postMessage({ target: 'cosmos-cs', id, method, params: params || {} }, window.location.origin);
    });
  }

  const api = {
    isCosmosWallet: true,
    id: 'cosmos',
    name: 'Cosmos Wallet',
    async isConnected() {
      try {
        const r = await request('isConnected');
        return !!(r && r.connected);
      } catch {
        return false;
      }
    },
    async getAddress() {
      return request('getAddress');
    },
    async getNetwork() {
      return request('getNetwork');
    },
    async getNetworkDetails() {
      return request('getNetwork');
    },
    async signTransaction(xdr, opts) {
      return request('signTransaction', { xdr, ...(opts || {}) });
    },
    async signMessage(message, opts) {
      return request('signMessage', { message, ...(opts || {}) });
    },
    // SEP-7 payment link (web+stellar:pay?…): the wallet parses, signs & submits it.
    async requestPayment(uri) {
      return request('requestPayment', { uri });
    },
  };

  Object.defineProperty(window, 'cosmosWallet', { value: Object.freeze(api), writable: false, configurable: false });
  // Let dapps that load early know the provider is ready.
  window.dispatchEvent(new Event('cosmosWallet#initialized'));

  /* ---------------------------------------------------------------- EVM (EIP-1193) */

  // The Cosmos mark as a data: URI (EIP-6963 asks for one); scripts/build-extension.ts writes it
  // from public/favicon.svg.
  const ICON = '__COSMOS_WALLET_ICON__';
  const listeners = new Map();
  let chainId = null;
  let accounts = [];

  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (e) {
        // A listener's error is the page's, not the provider's: report it without breaking the loop.
        setTimeout(() => {
          throw e;
        });
      }
    }
  }

  function setChain(id) {
    if (typeof id !== 'string' || id === chainId) return;
    const first = chainId === null;
    chainId = id;
    emit(first ? 'connect' : 'chainChanged', first ? { chainId: id } : id);
  }

  function setAccounts(list) {
    const next = Array.isArray(list) ? list.filter((a) => typeof a === 'string') : [];
    if (next.join() === accounts.join()) return;
    accounts = next;
    emit('accountsChanged', next.slice());
  }

  const evm = (method, params) => request('evm', { method, params });

  async function evmRequest(args) {
    if (!args || typeof args !== 'object' || typeof args.method !== 'string') {
      throw rpcError({ code: -32602, message: 'Expected { method, params }.' });
    }
    const method = args.method;
    const params = Array.isArray(args.params) ? args.params : [];
    let result;
    try {
      result = await evm(method, params);
    } catch (e) {
      throw e && typeof e.code === 'number' ? e : rpcError({ code: -32603, message: e && e.message });
    }
    if (method === 'eth_chainId') setChain(result);
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
      setAccounts(result);
      if (chainId === null || method === 'eth_requestAccounts') evm('eth_chainId', []).then(setChain, () => {});
    }
    if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
      setChain(await evm('eth_chainId', []).catch(() => chainId));
    }
    if (method === 'wallet_revokePermissions') setAccounts([]);
    return result;
  }

  const provider = {
    isCosmosWallet: true,
    request: evmRequest,
    on(event, fn) {
      if (typeof fn !== 'function') return provider;
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return provider;
    },
    removeListener(event, fn) {
      const set = listeners.get(event);
      if (set) set.delete(fn);
      return provider;
    },
    // Legacy entry points some libraries still call.
    enable() {
      return evmRequest({ method: 'eth_requestAccounts' });
    },
    isConnected() {
      return chainId !== null;
    },
  };
  provider.off = provider.removeListener;
  provider.addListener = provider.on;

  function uuid() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  const info = Object.freeze({ uuid: uuid(), name: 'Cosmos Wallet', icon: ICON, rdns: 'lat.cosmospay.wallet' });
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
  window.addEventListener('eip6963:requestProvider', announce);
  announce();

  // Never take `window.ethereum` from another wallet: a site that only reads it keeps theirs.
  if (window.ethereum === undefined) {
    Object.defineProperty(window, 'ethereum', { value: provider, writable: true, configurable: true });
    window.dispatchEvent(new Event('ethereum#initialized'));
  }
})();
