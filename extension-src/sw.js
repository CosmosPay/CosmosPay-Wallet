/**
 * Cosmos Wallet — background service worker (Chrome) / event page (Firefox).
 *
 * Routes dapp requests arriving over a Port from content scripts:
 *  - Read-only (getNetwork / isConnected / already-approved getAddress) are answered
 *    from a public "mirror" the approval page keeps in chrome.storage.local. The SW
 *    can't read the wallet's localStorage, so the mirror is how it learns the public
 *    address + network (never any secret).
 *  - connect (getAddress, first time) and signing open the approval window
 *    (approve/index.html?req=<rid>), where the user unlocks + approves and the page signs.
 *
 * The open Port keeps this worker alive during approval and carries the reply back
 * to the exact page that asked — no tabs.sendMessage, no host permissions.
 *
 * REQUEST IDENTITY — why there are two ids.
 * The page picks its own correlation id (`inpage.js` uses `${Date.now()}.${seq++}`,
 * which is guessable). That id is fine for matching a reply inside one page, but it
 * must never be the key this worker routes on: a hostile page could send a request
 * carrying a victim's in-flight id and take over its reply slot, or ask to `resume`
 * ids it guessed and collect somebody else's signed envelope. So every request gets
 * an internal `rid` (randomUUID) that only the worker and the approval window ever
 * see, and every lookup that a page can influence is additionally scoped by the
 * origin the content script stamped.
 */

const MIRROR_KEY = 'cosmos.dapp'; // { address, networkId, networkPassphrase, networkUrl, approvedOrigins: [] }
const REQ_PREFIX = 'cosmos.req.'; // session-scoped pending request, keyed by internal rid
const RES_PREFIX = 'cosmos.res.'; // session-scoped parked reply, keyed by origin + page id

const DEFAULT_NETWORK = {
  network: 'TESTNET',
  networkPassphrase: 'Test SDF Network ; September 2015',
  networkUrl: 'https://horizon-testnet.stellar.org',
};

// rid -> { port, windowId, origin, method, pageId }
const pending = new Map();

/* ------------------------------------------------------------------------------------------
 * EVM: the EIP-1193 provider's calls (extension-src/inpage.js) arrive as method 'evm' with the
 * JSON-RPC method and params inside. Rules (src/constants/evmDapp.ts, src/lib/evmDapp.ts):
 *  - a site sees only the EVM networks the wallet signs on in its mode (EVM_CHAINS, below);
 *  - eth_accounts answers the wallet's 0x address to a connected origin, [] to anyone else;
 *    eth_requestAccounts opens the approval window, whose connect is the same grant as the
 *    Stellar one (Settings → Connected sites lists and revokes both);
 *  - a chain switch to one of those networks needs no window: it moves no money, and the
 *    window names the chain on every signature;
 *  - read-only calls go to that chain's public node from here (the page never picks the node);
 *  - the three signing calls open the approval window, one at a time per site.
 * Errors travel as { code, message } (EIP-1193); the Stellar provider's stay strings.
 * ---------------------------------------------------------------------------------------- */

const EVM_METHOD = 'evm'; // EVM_DAPP_METHOD
const EVM_CHAIN_PREFIX = 'cosmos.evmchain.'; // EVM_CHAIN_SESSION_PREFIX
const EVM_DEFAULT_CHAIN = { mainnet: 1, testnet: 11155111 };
const PUBLIC_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

// The wallet's EVM networks per mode, as `evmDappChains(env)` in src/lib/evmDapp.ts answers;
// tests/unit/evmDapp.test.ts fails when the two differ and prints the line to paste here.
/* evm-chains:begin */
const EVM_CHAINS = {"mainnet":[{"chainId":1,"rpc":"https://ethereum-rpc.publicnode.com"},{"chainId":8453,"rpc":"https://base-rpc.publicnode.com"},{"chainId":42161,"rpc":"https://arbitrum-one-rpc.publicnode.com"},{"chainId":10,"rpc":"https://optimism-rpc.publicnode.com"},{"chainId":56,"rpc":"https://bsc-rpc.publicnode.com"},{"chainId":137,"rpc":"https://polygon-bor-rpc.publicnode.com"},{"chainId":43114,"rpc":"https://avalanche-c-chain-rpc.publicnode.com"},{"chainId":100,"rpc":"https://gnosis-rpc.publicnode.com"},{"chainId":80094,"rpc":"https://berachain-rpc.publicnode.com"},{"chainId":534352,"rpc":"https://scroll-rpc.publicnode.com"},{"chainId":196,"rpc":"https://rpc.xlayer.tech"},{"chainId":2741,"rpc":"https://api.mainnet.abs.xyz"},{"chainId":9745,"rpc":"https://rpc.plasma.to"},{"chainId":4663,"rpc":"https://rpc.mainnet.chain.robinhood.com"}],"testnet":[{"chainId":11155111,"rpc":"https://ethereum-sepolia-rpc.publicnode.com"},{"chainId":84532,"rpc":"https://base-sepolia-rpc.publicnode.com"},{"chainId":421614,"rpc":"https://arbitrum-sepolia-rpc.publicnode.com"},{"chainId":11155420,"rpc":"https://optimism-sepolia-rpc.publicnode.com"},{"chainId":97,"rpc":"https://bsc-testnet-rpc.publicnode.com"},{"chainId":80002,"rpc":"https://polygon-amoy-bor-rpc.publicnode.com"},{"chainId":43113,"rpc":"https://avalanche-fuji-c-chain-rpc.publicnode.com"},{"chainId":10200,"rpc":"https://gnosis-chiado-rpc.publicnode.com"},{"chainId":80069,"rpc":"https://bepolia.rpc.berachain.com"},{"chainId":1952,"rpc":"https://testrpc.xlayer.tech"},{"chainId":11124,"rpc":"https://api.testnet.abs.xyz"},{"chainId":9746,"rpc":"https://testnet-rpc.plasma.to"},{"chainId":46630,"rpc":"https://rpc.testnet.chain.robinhood.com"}]};
/* evm-chains:end */

// EVM_READ_METHODS and EVM_SIGN_METHODS of src/constants/evmDapp.ts (the same test compares them).
/* evm-read:begin */
const EVM_READ_METHODS = ["eth_blockNumber","eth_call","eth_estimateGas","eth_feeHistory","eth_gasPrice","eth_getBalance","eth_getBlockByNumber","eth_getCode","eth_getLogs","eth_getTransactionByHash","eth_getTransactionCount","eth_getTransactionReceipt","eth_maxPriorityFeePerGas"];
/* evm-read:end */
/* evm-sign:begin */
const EVM_SIGN_METHODS = ["eth_sendTransaction","personal_sign","eth_signTypedData_v4"];
/* evm-sign:end */

const EVM_ERR = { rejected: 4001, unauthorized: 4100, unsupported: 4200, unknownChain: 4902, pending: -32002, invalidParams: -32602, internal: -32603 };
const EVM_RPC_TIMEOUT_MS = 20000;

function evmError(code, message) {
  return { code, message };
}

/** The wallet's mode as the approval window last recorded it; test mode until it has. */
function evmMode(mirror) {
  if (mirror && (mirror.mode === 'mainnet' || mirror.mode === 'testnet')) return mirror.mode;
  return mirror && mirror.networkPassphrase === PUBLIC_PASSPHRASE ? 'mainnet' : 'testnet';
}

function evmChainKey(mode, origin) {
  return EVM_CHAIN_PREFIX + mode + ' ' + origin;
}

/** The chain `origin` has selected in `mode`, or the mode's default. */
async function evmChainOf(origin, mode) {
  const key = evmChainKey(mode, origin);
  let stored = null;
  try {
    stored = (await chrome.storage.session.get(key))[key];
  } catch {
    /* no session storage: the default */
  }
  const list = EVM_CHAINS[mode];
  return list.find((c) => c.chainId === stored) || list.find((c) => c.chainId === EVM_DEFAULT_CHAIN[mode]) || list[0];
}

/** A chain id as a page spells it (0x-hex, as EIP-3326 asks), or null. */
function evmParseChainId(raw) {
  if (typeof raw !== 'string' || !/^0x[0-9a-fA-F]{1,13}$/.test(raw)) return null;
  const n = parseInt(raw, 16);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const toHex = (n) => '0x' + n.toString(16);

async function evmRead(chain, method, params) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EVM_RPC_TIMEOUT_MS);
  try {
    const res = await fetch(chain.rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      credentials: 'omit',
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => null);
    if (!body || typeof body !== 'object') return { error: evmError(EVM_ERR.internal, 'The node answered HTTP ' + res.status + '.') };
    if (body.error) {
      const e = body.error;
      return { error: { code: typeof e.code === 'number' ? e.code : EVM_ERR.internal, message: String(e.message || 'Node error.'), data: e.data } };
    }
    return { result: body.result === undefined ? null : body.result };
  } catch (e) {
    return { error: evmError(EVM_ERR.internal, 'The node did not answer: ' + String((e && e.message) || e)) };
  } finally {
    clearTimeout(timer);
  }
}

/** Whether `origin` already has an EVM approval window open (one at a time per site). */
function evmBusy(origin) {
  for (const [, p] of pending) if (p.origin === origin && p.method === EVM_METHOD) return true;
  return false;
}

async function handleEvm(port, pageId, origin, call, mirror) {
  const reply = (result) => safePost(port, { id: pageId, result });
  const fail = (code, message) => safePost(port, { id: pageId, error: evmError(code, message) });
  const method = call && typeof call.method === 'string' ? call.method : '';
  const params = call && Array.isArray(call.params) ? call.params : [];
  if (!origin || origin === 'null') return fail(EVM_ERR.unauthorized, 'This page has no origin to connect.');

  const mode = evmMode(mirror);
  const chain = await evmChainOf(origin, mode);
  const approved = (mirror && mirror.approvedOrigins) || [];
  const account = mirror && typeof mirror.evmAddress === 'string' ? mirror.evmAddress : null;
  const granted = approved.includes(origin) && !!account;

  switch (method) {
    case 'eth_chainId':
      return reply(toHex(chain.chainId));
    case 'net_version':
      return reply(String(chain.chainId));
    case 'eth_accounts':
      return reply(granted ? [account] : []);
    case 'eth_coinbase':
      return reply(granted ? account : null);
    case 'eth_requestAccounts':
      if (granted) return reply([account]);
      if (evmBusy(origin)) return fail(EVM_ERR.pending, 'A request is already waiting in Cosmos Wallet.');
      return openApproval({ origin, method: EVM_METHOD, params: { method, params: [], chainId: chain.chainId }, pageId }, port);
    case 'wallet_switchEthereumChain':
    case 'wallet_addEthereumChain': {
      const wanted = evmParseChainId(params[0] && params[0].chainId);
      if (wanted === null) return fail(EVM_ERR.invalidParams, 'Expected { chainId } as a 0x-prefixed hex string.');
      const hit = EVM_CHAINS[mode].find((c) => c.chainId === wanted);
      if (!hit) {
        return method === 'wallet_addEthereumChain'
          ? fail(EVM_ERR.unsupported, 'Cosmos Wallet cannot add this chain.')
          : fail(EVM_ERR.unknownChain, 'Cosmos Wallet does not have this chain in its current mode.');
      }
      try {
        await chrome.storage.session.set({ [evmChainKey(mode, origin)]: hit.chainId });
      } catch {
        return fail(EVM_ERR.internal, 'Could not record the chain.');
      }
      return reply(null);
    }
    case 'wallet_revokePermissions':
      // The same grant as Settings → Connected sites: the site forgets the wallet, both chains.
      if (mirror && approved.includes(origin)) {
        await chrome.storage.local.set({ [MIRROR_KEY]: { ...mirror, approvedOrigins: approved.filter((o) => o !== origin) } });
      }
      return reply(null);
    default:
      break;
  }

  if (EVM_READ_METHODS.includes(method)) {
    const out = await evmRead(chain, method, params);
    return out.error ? safePost(port, { id: pageId, error: out.error }) : reply(out.result);
  }
  if (EVM_SIGN_METHODS.includes(method)) {
    if (!granted) return fail(EVM_ERR.unauthorized, 'Connect Cosmos Wallet to this site first (eth_requestAccounts).');
    if (evmBusy(origin)) return fail(EVM_ERR.pending, 'A request is already waiting in Cosmos Wallet.');
    return openApproval({ origin, method: EVM_METHOD, params: { method, params, chainId: chain.chainId }, pageId }, port);
  }
  return fail(EVM_ERR.unsupported, 'Unsupported method: ' + method);
}

/** Parked-reply key. Origin-scoped, so a page can only ever reclaim its own. */
function resKey(origin, pageId) {
  return RES_PREFIX + origin + '\u0000' + pageId;
}

function newRid() {
  try {
    return crypto.randomUUID();
  } catch {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
}

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

/**
 * Open the approval window for `req` and remember it under a fresh internal rid.
 * `req.pageId` is the page's own correlation id — used only when replying.
 */
async function openApproval(req, port) {
  const rid = newRid();
  const url = chrome.runtime.getURL('approve/index.html') + '?req=' + encodeURIComponent(rid);
  const win = await chrome.windows.create({ url, type: 'popup', width: 420, height: 640, focused: true });
  // windowId travels with the persisted request too, so a worker restart can still
  // rebuild `pending` (and thus the onRemoved backstop) from storage alone.
  await chrome.storage.session.set({
    [REQ_PREFIX + rid]: { id: rid, origin: req.origin, method: req.method, params: req.params, pageId: req.pageId, windowId: win.id },
  });
  pending.set(rid, { port, windowId: win.id, origin: req.origin, method: req.method, pageId: req.pageId });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'cosmos') return;

  port.onMessage.addListener((msg) => {
    if (!msg || msg.id == null) return;
    const pageId = msg.id;
    const method = msg.method;
    const params = msg.params || {};
    // Stamped by content.js from window.location.origin — the page cannot forge it,
    // because page JS has no way to open this port itself (no externally_connectable).
    const origin = msg.origin || '';

    (async () => {
      if (method === 'resume') {
        // Sent by content.js after reconnecting: the previous port died (often a
        // worker restart) while `ids` were still in flight. Reclaim whatever we can —
        // but ONLY entries belonging to this same origin.
        if (!origin) return;
        const ids = Array.isArray(params.ids) ? params.ids : [];
        const parked = await chrome.storage.session.get(ids.map((i) => resKey(origin, i)));
        for (const pid of ids) {
          const reply = parked[resKey(origin, pid)];
          if (reply) {
            safePost(port, reply);
            chrome.storage.session.remove(resKey(origin, pid)).catch(() => {});
            continue;
          }
          // Still awaiting approval? Rebind to the fresh port — matching on the pair
          // (origin, pageId), never on the page-supplied id alone.
          let rebound = false;
          for (const [, p] of pending) {
            if (p.origin === origin && p.pageId === pid) {
              p.port = port;
              rebound = true;
              break;
            }
          }
          if (!rebound) safePost(port, { id: pid, error: 'The request expired.' });
        }
        return;
      }

      const mirror = await getMirror();
      const approved = (mirror && mirror.approvedOrigins) || [];

      if (method === EVM_METHOD) return handleEvm(port, pageId, origin, params, mirror);

      if (method === 'getNetwork') return safePost(port, { id: pageId, result: networkReply(mirror) });
      if (method === 'isConnected') {
        return safePost(port, { id: pageId, result: { connected: approved.includes(origin) && !!(mirror && mirror.address) } });
      }
      if (method === 'getAddress') {
        if (approved.includes(origin) && mirror && mirror.address) return safePost(port, { id: pageId, result: { address: mirror.address } });
        return openApproval({ origin, method, params, pageId }, port);
      }
      if (method === 'signTransaction' || method === 'signMessage' || method === 'requestPayment') {
        return openApproval({ origin, method, params, pageId }, port);
      }
      return safePost(port, { id: pageId, error: 'Unsupported method: ' + method });
    })();
  });

  port.onDisconnect.addListener(() => {
    for (const [, p] of pending) if (p.port === port) p.port = null;
  });
});

// Approval window -> the user's decision + signed result. `msg.id` is the internal
// rid, which only the approval window (opened by us with that rid) can know.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'cosmos-approve-result') return undefined;
  // Only our own extension pages may resolve a request.
  if (sender.id !== chrome.runtime.id) return undefined;

  const rid = msg.id;
  const p = pending.get(rid);
  (async () => {
    const stored = p || (await chrome.storage.session.get(REQ_PREFIX + rid))[REQ_PREFIX + rid];
    if (!stored) {
      sendResponse({ ok: false });
      return;
    }
    // An EVM refusal is an EIP-1193 error; the window sends one, and anything else it sends
    // (a plain string) is the person saying no.
    const evmFailure = (e) => (e && typeof e === 'object' && typeof e.code === 'number' ? { code: e.code, message: String(e.message || '') } : evmError(EVM_ERR.rejected, String(e || 'User rejected the request.')));
    const failure = stored.method === EVM_METHOD ? evmFailure(msg.error) : msg.error || 'Rejected.';
    const reply = { id: stored.pageId, result: msg.ok ? msg.result : undefined, error: msg.ok ? undefined : failure };
    if (p && p.port) {
      safePost(p.port, reply);
      pending.delete(rid);
      chrome.storage.session.remove(REQ_PREFIX + rid).catch(() => {});
    } else {
      // No live port: the worker restarted, or the page's port died while the
      // approval window was open. Park the reply under (origin, pageId) — content.js
      // reclaims it via 'resume' once it reconnects, and only from that same origin.
      pending.delete(rid);
      if (stored.pageId != null && stored.origin) {
        chrome.storage.session.set({ [resKey(stored.origin, stored.pageId)]: reply }).catch(() => {});
      }
      chrome.storage.session.remove(REQ_PREFIX + rid).catch(() => {});
    }
    sendResponse({ ok: true });
  })();
  return true; // async sendResponse
});

// Address bar (omnibox): type the keyword `pay`, a space, then a web+stellar: URI.
// There is no page waiting for a reply — the approval window itself is the UX
// (it stays open showing the tx hash for address-bar requests).
if (chrome.omnibox) {
  chrome.omnibox.onInputEntered.addListener((text) => {
    const uri = text.trim();
    if (!/^web\+stellar:/i.test(uri)) return;
    openApproval({ origin: 'address-bar', method: 'requestPayment', params: { uri }, pageId: null }, null).catch(() => {});
  });
  if (chrome.omnibox.setDefaultSuggestion) {
    chrome.omnibox.setDefaultSuggestion({ description: 'Cosmos Wallet — paste a web+stellar:pay… link' });
  }
}

// If the user just closes the approval window, reject the pending request.
chrome.windows.onRemoved.addListener((windowId) => {
  for (const [rid, p] of pending) {
    if (p.windowId === windowId) {
      const closed = 'The user closed the approval window.';
      if (p.pageId != null) safePost(p.port, { id: p.pageId, error: p.method === EVM_METHOD ? evmError(EVM_ERR.rejected, closed) : closed });
      pending.delete(rid);
      chrome.storage.session.remove(REQ_PREFIX + rid).catch(() => {});
    }
  }
});
