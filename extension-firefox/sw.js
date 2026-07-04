/**
 * Cosmos Wallet — background service worker (Chrome) / event page (Firefox).
 *
 * Routes dapp requests arriving over a Port from content scripts:
 *  - Read-only (getNetwork / isConnected / already-approved getAddress) are answered
 *    from a public "mirror" the approval page keeps in chrome.storage.local. The SW
 *    can't read the wallet's localStorage, so the mirror is how it learns the public
 *    address + network (never any secret).
 *  - connect (getAddress, first time) and signing open the approval window
 *    (approve/index.html?req=<id>), where the user unlocks + approves and the page signs.
 *
 * The open Port keeps this worker alive during approval and carries the reply back
 * to the exact page that asked — no tabs.sendMessage, no host permissions.
 */

const MIRROR_KEY = 'cosmos.dapp'; // { address, networkId, networkPassphrase, networkUrl, approvedOrigins: [] }
const REQ_PREFIX = 'cosmos.req.'; // session-scoped pending request, keyed by id

const DEFAULT_NETWORK = {
  network: 'TESTNET',
  networkPassphrase: 'Test SDF Network ; September 2015',
  networkUrl: 'https://horizon-testnet.stellar.org',
};

// id -> { port, windowId, origin, method }
const pending = new Map();

async function getMirror() {
  try {
    const o = await chrome.storage.local.get(MIRROR_KEY);
    return o[MIRROR_KEY] || null;
  } catch {
    return null;
  }
}

function networkReply(mirror) {
  if (!mirror || !mirror.networkPassphrase) return { ...DEFAULT_NETWORK };
  return {
    network: mirror.networkId === 'public' ? 'PUBLIC' : mirror.networkId === 'testnet' ? 'TESTNET' : String(mirror.networkId || '').toUpperCase(),
    networkPassphrase: mirror.networkPassphrase,
    networkUrl: mirror.networkUrl,
  };
}

function safePost(port, msg) {
  if (!port) return; // omnibox/address-bar requests have no page to reply to
  try {
    port.postMessage(msg);
  } catch {
    /* port closed */
  }
}

async function openApproval(req, port) {
  await chrome.storage.session.set({ [REQ_PREFIX + req.id]: req });
  const url = chrome.runtime.getURL('approve/index.html') + '?req=' + encodeURIComponent(req.id);
  const win = await chrome.windows.create({ url, type: 'popup', width: 420, height: 640, focused: true });
  pending.set(req.id, { port, windowId: win.id, origin: req.origin, method: req.method });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'cosmos') return;

  port.onMessage.addListener((msg) => {
    if (!msg || msg.id == null) return;
    const id = msg.id;
    const method = msg.method;
    const params = msg.params || {};
    const origin = msg.origin || '';

    (async () => {
      const mirror = await getMirror();
      const approved = (mirror && mirror.approvedOrigins) || [];

      if (method === 'getNetwork') return safePost(port, { id, result: networkReply(mirror) });
      if (method === 'isConnected') {
        return safePost(port, { id, result: { connected: approved.includes(origin) && !!(mirror && mirror.address) } });
      }
      if (method === 'getAddress') {
        if (approved.includes(origin) && mirror && mirror.address) return safePost(port, { id, result: { address: mirror.address } });
        return openApproval({ id, origin, method, params }, port);
      }
      if (method === 'signTransaction' || method === 'signMessage' || method === 'requestPayment') {
        return openApproval({ id, origin, method, params }, port);
      }
      return safePost(port, { id, error: 'Método no soportado: ' + method });
    })();
  });

  port.onDisconnect.addListener(() => {
    for (const [id, p] of pending) if (p.port === port) pending.delete(id);
  });
});

// Approval window -> the user's decision + signed result.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'cosmos-approve-result') return undefined;
  const p = pending.get(msg.id);
  if (p) {
    safePost(p.port, { id: msg.id, result: msg.ok ? msg.result : undefined, error: msg.ok ? undefined : msg.error || 'Rechazado' });
    pending.delete(msg.id);
  }
  chrome.storage.session.remove(REQ_PREFIX + msg.id).catch(() => {});
  sendResponse({ ok: true });
  return true;
});

// Address bar (omnibox): type the keyword `pay`, a space, then a web+stellar: URI.
// There is no page waiting for a reply — the approval window itself is the UX
// (it stays open showing the tx hash for address-bar requests).
if (chrome.omnibox) {
  chrome.omnibox.onInputEntered.addListener((text) => {
    const uri = text.trim();
    if (!/^web\+stellar:/i.test(uri)) return;
    const id = 'omni.' + Math.random().toString(36).slice(2);
    openApproval({ id, origin: 'address-bar', method: 'requestPayment', params: { uri } }, null).catch(() => {});
  });
  if (chrome.omnibox.setDefaultSuggestion) {
    chrome.omnibox.setDefaultSuggestion({ description: 'Cosmos Wallet — pega un enlace web+stellar:pay…' });
  }
}

// If the user just closes the approval window, reject the pending request.
chrome.windows.onRemoved.addListener((windowId) => {
  for (const [id, p] of pending) {
    if (p.windowId === windowId) {
      safePost(p.port, { id, error: 'El usuario cerró la ventana de aprobación.' });
      pending.delete(id);
      chrome.storage.session.remove(REQ_PREFIX + id).catch(() => {});
    }
  }
});
