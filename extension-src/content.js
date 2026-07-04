/**
 * Cosmos Wallet — content script (isolated world).
 *
 * Two jobs:
 *  1. Inject inpage.js into the page's MAIN world so `window.cosmosWallet` exists.
 *  2. Bridge the page and the extension over a long-lived Port:
 *       page (postMessage 'cosmos-cs')  ->  port.postMessage  ->  service worker
 *       service worker (port.postMessage)  ->  page (postMessage 'cosmos-inpage')
 *
 * A Port (not tabs.sendMessage) keeps the service worker alive during the user's
 * approval and needs no host permissions — the content script always may talk to
 * its own extension.
 */
(() => {
  // 1) inject the provider into the page.
  try {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('inpage.js');
    s.async = false;
    (document.head || document.documentElement).prepend(s);
    s.onload = () => s.remove();
  } catch {
    /* some pages forbid script injection — ignore */
  }

  let port = null;
  function ensurePort() {
    if (port) return port;
    port = chrome.runtime.connect({ name: 'cosmos' });
    port.onMessage.addListener((msg) => {
      if (!msg || msg.id == null) return;
      window.postMessage({ target: 'cosmos-inpage', id: msg.id, result: msg.result, error: msg.error }, window.location.origin);
    });
    port.onDisconnect.addListener(() => {
      port = null;
    });
    return port;
  }

  // Address-bar convenience: a web+stellar: URI typed/pasted in the bar never
  // navigates (browsers treat unknown schemes there as a search query). Detect the
  // resulting search page (Google/Bing/DuckDuckGo) whose query IS a web+stellar:
  // URI and hand it to the wallet automatically — the approval window opens with
  // the parsed payment, no clicks needed.
  try {
    const h = location.hostname;
    const params = new URLSearchParams(location.search);
    const q = (params.get('q') || params.get('p') || '').trim();
    const isSearch =
      (/(^|\.)google\.[a-z.]{2,6}$/.test(h) && location.pathname === '/search') ||
      (/(^|\.)bing\.com$/.test(h) && location.pathname === '/search') ||
      h === 'duckduckgo.com' ||
      (/(^|\.)search\.yahoo\.com$/.test(h) && location.pathname.startsWith('/search'));
    if (isSearch && /^web\+stellar:/i.test(q)) {
      ensurePort().postMessage({ id: 'bar.' + Math.random().toString(36).slice(2), method: 'requestPayment', params: { uri: q }, origin: 'address-bar' });
    }
  } catch {
    /* never break the page */
  }

  // 2) page -> extension
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.target !== 'cosmos-cs' || d.id == null) return;
    try {
      ensurePort().postMessage({ id: d.id, method: d.method, params: d.params, origin: window.location.origin });
    } catch (e) {
      window.postMessage({ target: 'cosmos-inpage', id: d.id, error: String((e && e.message) || e) }, window.location.origin);
    }
  });
})();
