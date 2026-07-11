/**
 * Cosmos Wallet — in-page provider (runs in the web page's MAIN world).
 *
 * Exposes `window.cosmosWallet`, a SEP-43-style Stellar wallet interface, to dapps.
 * It has no access to keys: every call is forwarded (via postMessage) to the
 * content script, then to the extension, where the user approves and signs.
 *
 * API (all async, return Promises):
 *   cosmosWallet.getAddress()                 -> { address }
 *   cosmosWallet.getNetwork()                 -> { network, networkPassphrase, networkUrl }
 *   cosmosWallet.getNetworkDetails()          -> alias of getNetwork()
 *   cosmosWallet.signTransaction(xdr, opts?)  -> { signedTxXdr, signerAddress }
 *   cosmosWallet.signMessage(message, opts?)  -> { signedMessage, signerAddress }
 *   cosmosWallet.requestPayment(sep7Uri)      -> { hash, signerAddress }   (web+stellar:pay…)
 *   cosmosWallet.isConnected()                -> boolean
 */
(() => {
  if (window.cosmosWallet) return;

  const pending = new Map();
  let seq = 0;

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.target !== 'cosmos-inpage' || d.id == null) return;
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    if (d.error) p.reject(new Error(d.error));
    else p.resolve(d.result);
  });

  function request(method, params) {
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}.${seq++}`;
      pending.set(id, { resolve, reject });
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
})();
