// Self-contained stylesheet: approve.astro does not load app.css nor the theme
// CSS variables, so this sheet uses literal colors only (see its header).
import '@/styles/app/approve-popup.css';
import { useEffect, useMemo, useState } from 'react';
import { Keypair } from '@stellar/stellar-sdk';
import { APPROVE_TITLE_KEYS, OP_LABEL_KEYS, type DappMethod } from '@/constants/dapp';
import type { ChainNet } from '@/constants/chains';
import {
  ERC20_FN_KEYS,
  EVM_APPROVE_TITLE_KEYS,
  EVM_DAPP_METHOD,
  EVM_ERR,
  type Erc20Function,
  type EvmApproveMethod,
} from '@/constants/evmDapp';
import {
  EvmDappRefused,
  allowanceCoversAll,
  callNeedsAck,
  evmDappChain,
  formatUnits,
  messagePreview,
  parseEvmDappRequest,
  personalSignDigest,
  reviewCall,
  signEvmDigest,
  typedDataChainId,
  typedDataDigest,
  typedDataGrantFields,
  typedDataGrants,
  typedDataNeedsAck,
  type CallReview,
  type EvmDappChain,
  type EvmDappRequest,
} from '@/lib/evmDapp';
import { sendDappTransaction } from '@/lib/evmDappSend';
import { evmTokenBalanceAt } from '@/lib/chainRpc';
import { networkDefOn, networkNameOn, sendFeeReserveOn } from '@/lib/testnets';
import {
  awaitWebRequest,
  replyWebRequest,
  webSignerContext,
  type WebSignerNetwork,
  type WebSignerRequest,
} from '@/lib/webSigner';
import { grantApprovedOrigin, listApprovedOrigins, updateMirror } from '@/lib/dappOrigins';
import { getActiveEntry, getNetworkId, getCustomNetworks, unlockWallet, type VaultSecret, type WalletEntry } from '@/lib/vault';
import { beginAttempt, blockSeconds, noteAttemptSuccess, releaseAttempt } from '@/lib/attempts';
import { WrongPasswordError } from '@/lib/crypto';
import { PasskeyError, wipePasskeySecrets } from '@/lib/passkey';
import { PasskeyUnlockStaleError, passkeyUnlockCredential, unlockWithPasskey } from '@/lib/passkeyUnlock';
import { networkEnv, resolveNetwork, signXdr, sendPayment, type NetConfig } from '@/lib/stellar';
import { parseStellarQr, type ParsedQr } from '@/lib/sep7';
import { reviewTx, type TxReview } from '@/lib/txGuard';
import { signMessagePayload, SIGN_MESSAGE_DOMAIN } from '@/lib/signMessage';
import { memoKindFromSep7 } from '@/lib/memo';
import { cx } from '@/lib/cx';
import { makeT, savedLang, setDocumentLang, type TFn } from '@/lib/i18n';

// Extension API — no @types/chrome in this project; the popup only runs as an
// extension page where `chrome` exists (guarded by hasChrome()).
declare const chrome: any;

/**
 * Dapp-approval window. Self-contained: reuses the vault/stellar libs and shares the
 * wallet's own storage (same origin either way). No secret ever leaves this window.
 *
 *  - getAddress (connect): consent only — returns the PUBLIC key, remembers the origin.
 *  - signTransaction / signMessage: password -> unlock -> sign locally.
 *  - requestPayment (SEP-7 web+stellar:pay): password -> unlock -> build, sign & submit.
 *
 * On a PASSKEY device (`lib/passkeyUnlock.ts`) there is no password to type: Approve raises
 * the passkey sheet, which releases the device password, and everything after it — the
 * attempt ladder, `unlockWallet`, the signature — is the same code path. The field stays
 * one link away for a device caught halfway through a switch.
 *
 * TWO TRANSPORTS reach it, and the difference is confined to `loadReq` / `respond`:
 *
 *   extension  chrome-extension://…/approve/index.html?req=<internal rid>. The service
 *              worker parked the request in session storage and routes the answer back
 *              to the page's port. See extension-src/sw.js.
 *   web        https://<wallet>/approve/?web=1&n=…&o=… — the dapp opened this window
 *              itself and hands the request over by postMessage, because a hosted page
 *              has no background worker to route through. See src/lib/webSigner.ts.
 *
 * Everything between those two ends — the decode, the warnings, the acknowledgement,
 * the password, the signature — is one code path on purpose. A second approval screen
 * for the web is a second place for a check to be missing.
 */

interface DappReq {
  id: string;
  origin: string;
  /** A Stellar method, or `evm` with the JSON-RPC call in `params` (extension-src/sw.js). */
  method: DappMethod | typeof EVM_DAPP_METHOD;
  params: {
    xdr?: string;
    message?: string;
    uri?: string;
    networkPassphrase?: string;
    /** EVM: the JSON-RPC method, its params and the chain the site had selected. */
    method?: string;
    params?: unknown;
    chainId?: number;
  };
}

/** An EIP-1193 error, what an EVM request is refused with (the Stellar ones are strings). */
interface RpcError {
  code: number;
  message: string;
}

/**
 * An EVM request as the window read it: the request itself, the chain it is for, the account it
 * must be signed by, and — when it cannot be approved — why (`refusal`, an i18n key, and the
 * English `refusalMessage` the site gets).
 */
interface EvmView {
  method: EvmApproveMethod;
  env: ChainNet;
  account: string | null;
  chain: EvmDappChain | null;
  request: EvmDappRequest | null;
  call: CallReview | null;
  refusal: string | null;
  refusalMessage: string;
  refusalCode: number;
}

/** The wallet's 0x address, kept on the entry since the multi-network release (lib/vault.ts). */
const evmAccountOf = (e: WalletEntry | null): string | null => e?.networkAddresses?.byKind.evm ?? null;

const chainNetOf = (cfg: NetConfig): ChainNet => (networkEnv(cfg) === 'prod' ? 'mainnet' : 'testnet');

/** Read an EVM request against the wallet as it is now: its mode, its account, its chains. */
function readEvmRequest(req: DappReq, entry: WalletEntry | null, cfg: NetConfig): EvmView {
  const method = String(req.params.method || '') as EvmApproveMethod;
  const env = chainNetOf(cfg);
  const account = evmAccountOf(entry);
  const chain = evmDappChain(env, Number(req.params.chainId));
  const view: EvmView = { method, env, account, chain, request: null, call: null, refusal: null, refusalMessage: '', refusalCode: EVM_ERR.invalidParams };
  const refused = (key: string, message: string, code: number = EVM_ERR.invalidParams): EvmView => ({
    ...view,
    refusal: key,
    refusalMessage: message,
    refusalCode: code,
  });
  if (!Object.hasOwn(EVM_APPROVE_TITLE_KEYS, method)) return refused('approve.evm.err.method', `Unsupported method: ${method}`, EVM_ERR.unsupported);
  if (!account) return refused('approve.evm.err.noAccount', 'This wallet has no EVM account yet.', EVM_ERR.unauthorized);
  // The site's chain must be one the wallet signs on in the mode it is in NOW; the worker's view
  // of the mode can be older than the person's last switch.
  if (!chain) return refused('approve.evm.err.chain', 'The selected chain is not available in the wallet mode.', EVM_ERR.unknownChain);
  try {
    const request = parseEvmDappRequest(method, req.params.params, chain.chainId);
    const signer = request.kind === 'connect' ? account : request.kind === 'sendTransaction' ? request.tx.from : request.address;
    if (signer.toLowerCase() !== account.toLowerCase()) {
      return refused('approve.evm.err.from', 'The request names another account than the connected one.', EVM_ERR.unauthorized);
    }
    const tokens = networkDefOn(chain.network, env)?.tokens ?? [];
    const call = request.kind === 'sendTransaction' ? reviewCall(request.tx.to, request.tx.data, tokens) : null;
    return { ...view, request, call };
  } catch (e) {
    if (e instanceof EvmDappRefused) return refused(e.key, e.message, e.code);
    return refused('approve.evm.err.params', e instanceof Error ? e.message : String(e));
  }
}

/** What a failed EVM approval tells the site. */
function evmFailure(e: unknown): RpcError {
  if (e instanceof EvmDappRefused) return { code: e.code, message: e.message };
  return { code: EVM_ERR.internal, message: e instanceof Error ? e.message : String(e) };
}

/**
 * The web handshake this window is part of, or null when it was opened by the
 * extension (or by a human typing the address). Read once at module scope: it comes
 * from this document's own URL, which does not change while it is open.
 */
const WEB_CTX = typeof window === 'undefined' ? null : webSignerContext(window.location.href);

function hasChrome(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.storage;
}

/** The network facts every web reply carries, so the dapp never has to ask separately. */
function netInfo(cfg: NetConfig): WebSignerNetwork {
  return { network: cfg.id === 'public' ? 'PUBLIC' : cfg.id.toUpperCase(), networkPassphrase: cfg.passphrase, networkUrl: cfg.horizon };
}

async function loadReq(): Promise<DappReq | null> {
  if (WEB_CTX) {
    const req: WebSignerRequest | null = await awaitWebRequest(WEB_CTX);
    return req && { id: req.id, origin: req.origin, method: req.method, params: req.params };
  }
  if (!hasChrome()) return null;
  const id = new URL(window.location.href).searchParams.get('req') || '';
  const key = 'cosmos.req.' + id;
  const o = await chrome.storage.session.get(key);
  return (o[key] as DappReq) || null;
}

/**
 * Keep the SW's read-only mirror in sync: the public Stellar address, the network, the wallet's
 * 0x address and its mode (what the EVM provider answers `eth_accounts` and picks chains with),
 * and the approved origins.
 */
async function writeMirror(patch: { entry: WalletEntry; cfg: NetConfig }) {
  if (!hasChrome()) return;
  // Under the mirror's lock, from a copy read inside it (`updateMirror`): a site's revoke in the
  // worker, or one in Settings, is never undone by this window putting back an older list. The
  // grant lists are carried over untouched; only `grantApprovedOrigin` adds to them.
  await updateMirror((cur) => {
    return {
      ...cur,
      address: patch.entry.publicKey,
      networkId: patch.cfg.id,
      networkPassphrase: patch.cfg.passphrase,
      networkUrl: patch.cfg.horizon,
      evmAddress: evmAccountOf(patch.entry),
      mode: chainNetOf(patch.cfg),
    };
  });
}

/**
 * Answer the request and close, on whichever transport brought it.
 *
 * `net` is merged into a successful web result: the provider has no background page to
 * ask which network the wallet is on, so every reply tells it. It is added rather than
 * substituted — a dapp reading `signedTxXdr` keeps reading `signedTxXdr` — and the
 * extension's replies are left byte-for-byte as they were, because those travel to
 * pages built against them.
 */
function respond(req: DappReq, ok: boolean, result?: unknown, error?: string | RpcError, keepOpen = false, net?: WebSignerNetwork) {
  if (WEB_CTX) {
    // The web transport carries Stellar requests only, whose errors are strings.
    if (req.method === EVM_DAPP_METHOD) return;
    const payload = ok && net && result && typeof result === 'object' ? { ...(result as object), ...net } : result;
    replyWebRequest({ ...req, method: req.method }, ok, payload, typeof error === 'string' ? error : error?.message);
    if (!keepOpen) window.close();
    return;
  }
  if (!hasChrome()) {
    if (!keepOpen) window.close();
    return;
  }
  try {
    // Close only once the SW has acknowledged the message, not on a fixed timer: a
    // cold service-worker start can take longer than a short timeout, and closing
    // early risks the message going out after the sender (this window) is gone.
    chrome.runtime.sendMessage({ type: 'cosmos-approve-result', id: req.id, ok, result, error }, () => {
      void chrome.runtime.lastError;
      // Address-bar requests have no page waiting: keep the window open to show the result.
      if (!keepOpen) window.close();
    });
  } catch {
    if (!keepOpen) window.close();
  }
}

export default function ApprovePopup() {
  const [req, setReq] = useState<DappReq | null>(null);
  const [entry, setEntry] = useState<WalletEntry | null>(null);
  const [cfg, setCfg] = useState<NetConfig | null>(null);
  const [pay, setPay] = useState<ParsedQr | null>(null);
  const [payErr, setPayErr] = useState('');
  // Decoded signTransaction payload — what the user actually approves.
  const [review, setReview] = useState<TxReview | null>(null);
  const [reviewErr, setReviewErr] = useState('');
  // Set when the dapp asks to sign against a different network than the wallet's.
  // Nothing can be approved in that state; only Reject stays available.
  const [netMismatch, setNetMismatch] = useState('');
  /** An EVM request (`evm`), read against the wallet; null for a Stellar one. */
  const [evm, setEvm] = useState<EvmView | null>(null);
  /** The account's balance of the token an allowance is for; null until read, or when it cannot be. */
  const [allowanceBalance, setAllowanceBalance] = useState<bigint | null>(null);
  const [loaded, setLoaded] = useState(false);
  const t = useMemo(() => makeT(savedLang()), []);
  // The window speaks the wallet's language, and its `<html lang>` says so.
  useEffect(() => setDocumentLang(savedLang()), []);
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  /** Explicit acknowledgement for a takeover-capable or co-signed envelope. */
  const [ack, setAck] = useState(false);
  // Set after an address-bar payment succeeds: keeps the window open showing the hash.
  const [doneHash, setDoneHash] = useState('');
  /** This device opens with a passkey; the field is a fallback behind a link. */
  const [passkeyDevice, setPasskeyDevice] = useState(false);
  const [pwdForm, setPwdForm] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [r, e, netId, custom, pk] = await Promise.all([
          loadReq(),
          getActiveEntry(),
          getNetworkId(),
          getCustomNetworks(),
          passkeyUnlockCredential(),
        ]);
        const c = resolveNetwork(netId, custom);
        setPasskeyDevice(pk !== null);
        setReq(r);
        setEntry(e);
        setCfg(c);
        // A site the user already connected does not get asked about again — the same
        // answer the extension's service worker gives from its mirror without opening
        // anything. On the web there is no mirror to read, so the window opens, answers
        // and closes; what it must NOT do is turn a re-connect into a fresh consent
        // dialog the user learns to click through.
        if (WEB_CTX && r && e && r.method === 'getAddress' && (await listApprovedOrigins()).includes(r.origin)) {
          respond(r, true, { address: e.publicKey }, undefined, false, netInfo(c));
          return;
        }
        if (r && r.method === EVM_DAPP_METHOD) setEvm(readEvmRequest(r, e, c));
        if (r && r.method === 'requestPayment') {
          const parsed = parseStellarQr(String(r.params.uri || ''));
          if (parsed) setPay(parsed);
          else setPayErr(t('approve.badSep7'));
        }
        if (r && r.method === 'signTransaction') {
          // A dapp may state which network it built for, but it does NOT get to
          // choose the one we sign against: the passphrase is not carried inside the
          // envelope, so accepting theirs is what lets a "Testnet" approval produce a
          // valid mainnet signature. Mismatch => refuse, don't silently re-target.
          const asked = String(r.params.networkPassphrase || '');
          if (asked && asked !== c.passphrase) {
            setNetMismatch(t('approve.netMismatch', { network: c.label }));
          } else {
            try {
              setReview(reviewTx(c, String(r.params.xdr || '')));
            } catch (err) {
              setReviewErr(err instanceof Error ? err.message : String(err));
            }
          }
        }
        if (e) await writeMirror({ entry: e, cfg: c }); // keep the SW mirror fresh
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // An allowance for a registry token: read the balance it would cover, so one that takes all of
  // it says so (`allowanceCoversAll`). Unread, only the unlimited threshold applies; either way
  // the allowance needs the acknowledgement.
  useEffect(() => {
    const call = evm?.call;
    if (!evm?.chain || !evm.account || call?.kind !== 'erc20' || !call.grant) return;
    let live = true;
    evmTokenBalanceAt(evm.chain.rpc, call.token.asset, evm.account)
      .then((b) => live && setAllowanceBalance(b))
      .catch(() => live && setAllowanceBalance(null));
    return () => {
      live = false;
    };
  }, [evm]);

  if (!loaded) return <Frame><p className="approve-muted">{t('approve.loading')}</p></Frame>;
  if (!req) return <Frame><Title>{t('approve.notFound')}</Title><p className="approve-muted">{t('approve.notFoundBody')}</p></Frame>;
  if (!entry || !cfg) {
    return (
      <Frame>
        <Title>{t('approve.noWallet')}</Title>
        <p className="approve-muted">{t('approve.noWalletBody')}</p>
        <Btn
          kind="reject"
          onClick={() =>
            respond(req, false, undefined, req.method === EVM_DAPP_METHOD ? { code: EVM_ERR.unauthorized, message: 'No wallet on this device.' } : 'No wallet on this device.')
          }
        >
          {t('approve.close')}
        </Btn>
      </Frame>
    );
  }

  const isConnect = req.method === 'getAddress';
  const isPay = req.method === 'requestPayment';
  const short = (s: string, n = 10) => (s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);
  const payAsset = pay ? (pay.assetCode && pay.assetIssuer ? pay.assetCode : 'XLM') : '';
  const originLabel = req.origin === 'address-bar' ? t('approve.addressBar') : req.origin;

  if (doneHash) {
    return (
      <Frame>
        <Title>{t('approve.paymentSent')}</Title>
        <div className="approve-card">
          <Row label={t('approve.rowHash')} value={short(doneHash, 12)} mono />
          <Row label={t('approve.rowNetwork')} value={cfg.label} />
        </div>
        <p className="approve-success">{t('approve.paymentSentBody')}</p>
        <Btn kind="approve" onClick={() => window.close()}>{t('approve.close')}</Btn>
      </Frame>
    );
  }

  const usePasskey = passkeyDevice && !pwdForm;

  /**
   * Open the vault for one signature — and THAT is a password guess like any other. This window
   * was the one path that derived a key from a typed string with no backoff at all: same vault,
   * same PBKDF2 cost, same localStorage, opened on demand by any page calling
   * window.cosmosWallet.* — an unmetered oracle sitting beside the metered ones. `beginAttempt`
   * reserves the guess before the derivation, so concurrent windows cannot all read a clean
   * record.
   *
   * On a passkey device the password comes out of the passkey door first. A dismissed sheet or a
   * stale door is retryable, like a typo — see the catch in `approve`.
   */
  const openVaultSecret = async (): Promise<VaultSecret> => {
    let password = pwd;
    if (usePasskey) {
      const opened = await unlockWithPasskey();
      wipePasskeySecrets(opened.secrets);
      password = opened.password;
    }
    const wait = await beginAttempt();
    if (wait > 0) throw new Error(t('pwd.tooManyAttempts', { secs: String(blockSeconds(wait)) }));
    const vault = await unlockWallet(entry.id, password).catch(async (e: unknown) => {
      // Only a failed GCM tag is a guess. A missing or unparseable vault blob must not
      // walk the owner up the ladder while the screen blames their password.
      if (!(e instanceof WrongPasswordError)) await releaseAttempt();
      throw e;
    });
    await noteAttemptSuccess();
    // Refresh the public mirror, but do NOT grant the origin here: signing once is
    // not consent to be recognised forever. Only the explicit connect approval
    // (getAddress / eth_requestAccounts) grants the origin, each its own account's list.
    await writeMirror({ entry, cfg });
    return vault;
  };

  /**
   * An EVM request, approved: the connect grants the origin the 0x account (its own list —
   * connecting for one account is not consent to show the other);
   * everything else opens the vault, derives the 0x key — refused unless it spells the account
   * the site was granted — and signs or sends. The key is wiped whatever happens.
   */
  const approveEvm = async (v: EvmView) => {
    const { request, chain, account } = v;
    if (v.refusal || !request || !chain || !account) {
      throw new EvmDappRefused(v.refusal ?? 'approve.evm.err.params', v.refusalMessage || 'Refused.', v.refusalCode);
    }
    if (request.kind === 'connect') {
      await writeMirror({ entry, cfg });
      await grantApprovedOrigin(req.origin, 'evm');
      respond(req, true, [account]);
      return;
    }
    const vault = await openVaultSecret();
    const [{ networksPhraseFromSecret }, { networkSecret }] = await Promise.all([import('@/lib/chainAddresses'), import('@/lib/chainKeys')]);
    const secret = await networkSecret(vault.mnemonic ?? networksPhraseFromSecret(vault.secret), chain.network, account, v.env).catch(() => {
      throw new EvmDappRefused('approve.evm.err.key', 'The key does not match the account.', EVM_ERR.unauthorized);
    });
    try {
      if (request.kind === 'personalSign') {
        respond(req, true, signEvmDigest(personalSignDigest(request.message), secret));
        return;
      }
      if (request.kind === 'signTypedData') {
        respond(req, true, signEvmDigest(typedDataDigest(request.typed), secret));
        return;
      }
      const hash = await sendDappTransaction({ chain, env: v.env, secret, tx: request.tx });
      respond(req, true, hash);
    } finally {
      secret.fill(0);
    }
  };

  // Arrow (not a hoisted function declaration) so TS carries the null-narrowing of
  // req/entry/cfg from the early returns above into this closure.
  const approve = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      if (evm) {
        await approveEvm(evm);
        return;
      }
      if (req.method === 'getAddress') {
        // Two stores, one meaning: the extension's grant lives in the service worker's
        // mirror (which is also how it answers a read without opening a window), the
        // web's in this build's own storage. `grantApprovedOrigin` picks; both are what
        // Settings → Connected sites lists and revokes.
        await writeMirror({ entry, cfg });
        await grantApprovedOrigin(req.origin, 'stellar');
        respond(req, true, { address: entry.publicKey }, undefined, false, netInfo(cfg));
        return;
      }

      // Everything below needs the secret -> unlock first.
      const { secret } = await openVaultSecret();

      if (req.method === 'signTransaction') {
        if (netMismatch) throw new Error(netMismatch);
        if (reviewErr) throw new Error(reviewErr);
        // `cfg` — the wallet's network — and never req.params.networkPassphrase.
        const signedTxXdr = signXdr(cfg, secret, String(req.params.xdr || ''));
        respond(req, true, { signedTxXdr, signerAddress: entry.publicKey }, undefined, false, netInfo(cfg));
        return;
      }
      if (req.method === 'signMessage') {
        // Sign a domain-separated digest, never the caller's raw bytes — otherwise a
        // 32-byte "message" that is really a transaction hash yields a valid
        // transaction signature. See lib/signMessage.ts.
        const digest = await signMessagePayload(String(req.params.message || ''));
        const sig = Keypair.fromSecret(secret).sign(Buffer.from(digest));
        respond(
          req,
          true,
          { signedMessage: Buffer.from(sig).toString('base64'), signerAddress: entry.publicKey, domain: SIGN_MESSAGE_DOMAIN },
          undefined,
          false,
          netInfo(cfg),
        );
        return;
      }
      if (req.method === 'requestPayment') {
        if (!pay) throw new Error(payErr || t('approve.badPayLink'));
        const { hash } = await sendPayment({
          cfg,
          secret,
          account: entry.publicKey,
          destination: pay.destination,
          amount: pay.amount || '0',
          memo: pay.memo,
          // The link's memo TYPE has to survive: a MEMO_ID request sent as text
          // arrives unattributed at the payee.
          memoKind: memoKindFromSep7(pay.memoType) ?? 'text',
          asset: pay.assetCode && pay.assetIssuer ? { code: pay.assetCode, issuer: pay.assetIssuer } : null,
        });
        const fromBar = req.origin === 'address-bar';
        respond(req, true, { hash, signerAddress: entry.publicKey }, undefined, fromBar, netInfo(cfg));
        if (fromBar) {
          setDoneHash(hash);
          setBusy(false);
        }
        return;
      }
    } catch (e) {
      // A passkey sheet the person closed, or a door that does not open this device, is as
      // retryable as a mistyped password — the request stays pending. The dismissal says
      // nothing at all; the other two say what happened.
      const passkeyRetry = e instanceof PasskeyError || e instanceof PasskeyUnlockStaleError;
      const wrongPwd = e instanceof WrongPasswordError || passkeyRetry;
      const message =
        e instanceof PasskeyError
          ? e.reason === 'cancelled'
            ? ''
            : t('passkey.err.failed')
          : e instanceof PasskeyUnlockStaleError || (usePasskey && e instanceof WrongPasswordError)
            ? t('passkey.err.stale')
            : e instanceof WrongPasswordError
              ? t('confirmSig.wrongPwd')
              : e instanceof EvmDappRefused
                ? t(e.key)
                : e instanceof Error
                  ? e.message
                  : String(e);
      setErr(message);
      setBusy(false);
      // A wrong password is retryable — leave the request pending so the user can just
      // try again. Anything else (malformed XDR, a failed payment build/submit, a
      // missing vault entry, …) is terminal: nothing will ever retry it, so without a
      // reply here the dapp's promise would hang forever. Keep the window open so the
      // user still sees the message; respond() unblocks the dapp regardless.
      //
      // Branched on `message !== 'Contraseña incorrecta.'` until now: a comparison
      // against Spanish UI copy, deciding retryable-vs-terminal. One i18n pass and every
      // mistyped password here became a terminal rejection — and that pass has now
      // happened. `WrongPasswordError` is imported two lines above and exists for this.
      if (!wrongPwd) respond(req, false, undefined, evm ? evmFailure(e) : message, true);
    }
  };

  // A transaction the window could not decode — or one aimed at another network —
  // is never approvable: the only honest action left is Reject.
  const isSignTx = req.method === 'signTransaction';
  const foreignSource = !!review && review.source !== entry.publicKey;
  /**
   * The two conditions that can hand the account away, and the only ones this window
   * asks the user to say out loud.
   *
   * `foreignSource` was computed one line up and then *not used* — a check by
   * appearance only. `hasCritical` was never consulted either, so a `setOptions`
   * adding an attacker's signer was one password and one click, behind a red banner
   * that the Approve button ignored. This is the path an arbitrary website reaches,
   * and it was the least guarded one in the wallet.
   *
   * NOT a refusal, deliberately: legitimate dapps do set signers and do co-sign, and
   * refusing outright would break them. It is a separate, explicit acknowledgement
   * instead — the button stays dead until the user ticks it, so approving one of these
   * can no longer happen on the same reflex as approving anything else.
   */
  const needsAck = !!review && (review.hasCritical || foreignSource);
  // What proves the person is here: the passkey, or a typed password.
  const hasProof = usePasskey || !!pwd;
  const canApprove =
    !netMismatch &&
    !reviewErr &&
    (!needsAck || ack) &&
    (isConnect || (isPay ? !!pay && hasProof : isSignTx ? !!review && hasProof : hasProof));

  /* An EVM request: the same frame, the same proof, its own rows. Nothing here can be approved
     while `refusal` stands. Everything but a plain coin payment, a registry token's `transfer` and
     a text message needs the explicit acknowledgement (`callNeedsAck`, `typedDataNeedsAck`): an
     allowance outlives the transaction, a contract the wallet does not list may answer an ERC-20
     selector with anything, and a typed signature may be an order redeemed later. */
  if (req.method === EVM_DAPP_METHOD) {
    const v = evm;
    if (!v) return <Frame><p className="approve-muted">{t('approve.loading')}</p></Frame>;
    const def = v.chain ? networkDefOn(v.chain.network, v.env) : null;
    const coin = def?.coin ?? '';
    const decimals = def?.decimals ?? 18;
    const kind = v.request?.kind ?? null;
    const tx = v.request?.kind === 'sendTransaction' ? v.request.tx : null;
    const typed = v.request?.kind === 'signTypedData' ? v.request.typed : null;
    const message = v.request?.kind === 'personalSign' ? messagePreview(v.request.message) : null;
    const call = v.call;
    const grant = call?.kind === 'erc20' && call.grant;
    // An allowance that is unlimited, or at least the balance read for it: everything the
    // account holds of that token. A contract's would-be allowance is red as a contract already.
    const coversAll = call?.kind === 'erc20' && call.grant && allowanceCoversAll(call.amount, allowanceBalance);
    const typedGrantFields = typed ? typedDataGrantFields(typed) : [];
    const typedGrants = !!typed && typedDataGrants(typed);
    const evmNeedsAck = (!!call && callNeedsAck(call)) || (!!typed && typedDataNeedsAck(typed));
    const evmConnect = kind === 'connect';
    const evmSend = kind === 'sendTransaction';
    const canApproveEvm = !v.refusal && !!v.request && (!evmNeedsAck || ack) && (evmConnect || hasProof);
    const amountLabel = (c: Extract<CallReview, { kind: 'erc20' }>) =>
      c.unlimited ? t('approve.evm.unlimited') : `${formatUnits(c.amount, c.token.decimals)} ${c.token.symbol}`;
    const counterpartyLabel = (fn: Erc20Function) => t(fn === 'approve' || fn === 'increaseAllowance' ? 'approve.evm.rowSpender' : 'approve.evm.rowRecipient');
    const domainChain = typed ? typedDataChainId(typed) : null;
    const rejectEvm = () => respond(req, false, undefined, { code: EVM_ERR.rejected, message: 'User rejected the request.' });

    return (
      <Frame>
        <div className="approve-origin">
          <div className="approve-origin-label">{t('approve.requestFrom')}</div>
          <div className="approve-origin-host">{originLabel}</div>
        </div>

        <Title>{t(EVM_APPROVE_TITLE_KEYS[v.method] ?? 'approve.evm.title.unknown')}</Title>

        <div className="approve-card">
          <Row label={t('approve.rowWallet')} value={entry.name || t('approve.defaultWalletName')} />
          <Row label={t('approve.evm.rowAccount')} value={v.account ? short(v.account) : '—'} mono />
          <Row label={t('approve.rowNetwork')} value={v.chain ? networkNameOn(v.chain.network, v.env) : '—'} />

          {tx && v.chain && (
            <>
              <div className="approve-divider" />
              <Row label={t('approve.evm.rowTo')} value={short(tx.to)} mono />
              <Row label={t('approve.evm.rowValue')} value={`${formatUnits(tx.value, decimals)} ${coin}`} />
              <Row label={t('approve.evm.rowFeeCap')} value={`${formatUnits(sendFeeReserveOn(v.chain.network, v.env), decimals)} ${coin}`} />
              {call?.kind === 'erc20' && (
                <div className="approve-ops">
                  <div className={cx('approve-op', (call.grant || call.fn === 'transferFrom') && 'is-critical')}>
                    <div className="approve-op-type">{t(ERC20_FN_KEYS[call.fn])}</div>
                    <Row label={t('approve.evm.rowToken')} value={call.token.symbol} />
                    {call.owner && <Row label={t('approve.evm.rowOwner')} value={short(call.owner)} mono />}
                    <Row label={counterpartyLabel(call.fn)} value={short(call.counterparty)} mono />
                    <Row label={t('approve.evm.rowAmount')} value={amountLabel(call)} />
                  </div>
                </div>
              )}
              {call?.kind === 'contract' && (
                <div className="approve-ops">
                  <div className="approve-op is-critical">
                    <div className="approve-op-type">{t('approve.evm.contractCall')}</div>
                    <Row label={t('approve.evm.rowSelector')} value={call.selector} mono />
                    <Row label={t('approve.evm.rowDataSize')} value={t('approve.evm.bytes', { n: String(call.bytes) })} />
                    {/* What the arguments would mean for an honest ERC-20: a hint, the contract decides. */}
                    {call.erc20 && (
                      <>
                        <Row label={t('approve.evm.looksLike')} value={t(ERC20_FN_KEYS[call.erc20.fn])} />
                        {call.erc20.owner && <Row label={t('approve.evm.rowOwner')} value={short(call.erc20.owner)} mono />}
                        <Row label={counterpartyLabel(call.erc20.fn)} value={short(call.erc20.counterparty)} mono />
                        <Row
                          label={t('approve.evm.rowAmount')}
                          value={call.erc20.unlimited ? t('approve.evm.unlimited') : t('approve.evm.rawUnits', { n: call.erc20.amount.toString() })}
                        />
                      </>
                    )}
                  </div>
                  <div className="approve-msg">{tx.data}</div>
                </div>
              )}
            </>
          )}

          {message && (
            <>
              <div className="approve-divider" />
              <div className="approve-row-label">{t(message.hex ? 'approve.evm.messageHex' : 'approve.messageToSign')}</div>
              <div className="approve-msg">{message.text}</div>
            </>
          )}

          {typed && (
            <>
              <div className="approve-divider" />
              {typeof typed.domain.name === 'string' && <Row label={t('approve.evm.rowDomain')} value={typed.domain.name} />}
              {typeof typed.domain.version === 'string' && <Row label={t('approve.evm.rowVersion')} value={typed.domain.version} />}
              {domainChain !== null && <Row label={t('approve.evm.rowChainId')} value={String(domainChain)} />}
              {typeof typed.domain.verifyingContract === 'string' && (
                <Row label={t('approve.evm.rowContract')} value={short(typed.domain.verifyingContract)} mono />
              )}
              <Row label={t('approve.evm.rowPrimaryType')} value={typed.primaryType} mono />
              <div className="approve-row-label">{t('approve.evm.typedMessage')}</div>
              <div className="approve-msg">{JSON.stringify(typed.message, null, 2)}</div>
            </>
          )}
        </div>

        {v.refusal && <div className="approve-danger">⛔ {t(v.refusal)}</div>}
        {call?.kind === 'contract' && (
          <div className="approve-danger">⚠️ {t(call.erc20 ? 'approve.evm.warnUnknownToken' : 'approve.evm.warnContract')}</div>
        )}
        {grant && <div className="approve-danger">⚠️ {t(coversAll ? 'approve.evm.warnUnlimited' : 'approve.evm.warnAllowance')}</div>}
        {call?.kind === 'erc20' && call.fn === 'transferFrom' && <div className="approve-danger">⚠️ {t('approve.evm.warnTransferFrom')}</div>}
        {typed && (
          <div className="approve-danger">
            ⚠️ {typedGrants ? t('approve.evm.warnTypedGrant', { fields: typedGrantFields.join(', ') || typed.primaryType }) : t('approve.evm.warnTyped')}
          </div>
        )}

        {evmNeedsAck && !v.refusal && (
          <label className="approve-ack">
            <input type="checkbox" checked={ack} onChange={(e) => setAck((e.target as HTMLInputElement).checked)} className="approve-ack-box" />
            <span className="approve-ack-text">{t('approve.evm.ack')}</span>
          </label>
        )}

        <p className="approve-note">{t(evmConnect ? 'approve.evm.noteConnect' : evmSend ? 'approve.evm.noteSend' : 'approve.noteSign')}</p>

        {!evmConnect && !v.refusal && usePasskey && (
          <p className="approve-muted">
            {t('passkey.approveNote')}{' '}
            <button type="button" className="approve-link" onClick={() => setPwdForm(true)}>
              {t('passkey.usePassword')}
            </button>
          </p>
        )}
        {!evmConnect && !v.refusal && !usePasskey && (
          <input
            type="password"
            value={pwd}
            autoFocus
            placeholder={t('approve.pwdPlaceholder')}
            onChange={(e) => setPwd((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && canApproveEvm && approve()}
            className="approve-input"
          />
        )}

        {err && <div className="approve-error">{err}</div>}

        <div className="approve-actions">
          <Btn kind="reject" onClick={rejectEvm}>{t('approve.reject')}</Btn>
          <Btn kind="approve" onClick={approve} disabled={busy || !canApproveEvm}>
            {busy ? t(evmSend ? 'approve.sending' : 'approve.signing') : t(evmConnect ? 'approve.connect' : evmSend ? 'approve.send' : 'approve.approve')}
          </Btn>
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="approve-origin">
        <div className="approve-origin-label">{t('approve.requestFrom')}</div>
        <div className="approve-origin-host">{originLabel}</div>
      </div>

      <Title>{t(APPROVE_TITLE_KEYS[req.method])}</Title>

      <div className="approve-card">
        <Row label={t('approve.rowWallet')} value={entry.name || t('approve.defaultWalletName')} />
        <Row label={t('approve.rowYourAddress')} value={short(entry.publicKey)} mono />
        <Row label={t('approve.rowNetwork')} value={cfg.label} />

        {isPay && pay && (
          <>
            <div className="approve-divider" />
            <Row label={t('approve.rowSendTo')} value={short(pay.destination)} mono />
            <Row label={t('approve.rowAmount')} value={`${pay.amount || '—'} ${payAsset}`} />
            {pay.memo && <Row label={t('approve.rowMemo')} value={pay.memo} />}
          </>
        )}
        {isPay && payErr && <div className="approve-pay-error">{payErr}</div>}

        {req.method === 'signMessage' && (
          <>
            <div className="approve-divider" />
            <div className="approve-row-label">{t('approve.messageToSign')}</div>
            <div className="approve-msg">{String(req.params.message || '')}</div>
          </>
        )}

        {req.method === 'signTransaction' && review && (
          <>
            <div className="approve-divider" />
            {/* The window used to decode `source`, `feeBumpSource`, `sequence` and
                `signatures` and then render none of them: it consumed only
                `hasCritical`. Everything the envelope commits you to is shown. */}
            <Row label={t('approve.rowSource')} value={foreignSource ? short(review.source) : t('approve.yourAccount')} mono={foreignSource} />
            <Row label={t('approve.rowFee')} value={`${review.feeXlm} XLM`} />
            <Row label={t('approve.rowSequence')} value={review.sequence || '—'} mono />
            <Row label={t('approve.rowExpires')} value={expiryLabel(t, review.maxTime)} />
            {review.signatures > 0 && <Row label={t('approve.rowSignatures')} value={String(review.signatures)} />}
            {review.feeBumpSource && <Row label={t('approve.rowFeeBumpFrom')} value={short(review.feeBumpSource)} mono />}
            {review.memo && <Row label={t('approve.rowMemo')} value={`${review.memo} (${review.memoType})`} />}
            <div className="approve-ops">
              {review.operations.map((op, i) => (
                <div key={i} className={cx('approve-op', op.critical && 'is-critical')}>
                  <div className="approve-op-type">
                    {i + 1}. {OP_LABEL_KEYS[op.type] ? t(OP_LABEL_KEYS[op.type]) : op.type}
                  </div>
                  {op.rows.map((r) => (
                    <div key={r.label} className="approve-row">
                      <span className="approve-row-label">{r.label}</span>
                      <span className="approve-row-value approve-mono">{r.value}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {netMismatch && <div className="approve-danger">⛔ {netMismatch}</div>}
      {reviewErr && <div className="approve-danger">⛔ {t('approve.readFailed', { msg: reviewErr })}</div>}
      {review?.hasCritical && (
        <div className="approve-danger">
          ⚠️ {t('approve.warnCritical')}
        </div>
      )}
      {foreignSource && (
        <div className="approve-danger">
          ⚠️ {t('approve.warnForeignSource')}
        </div>
      )}
      {review?.feeBumpSource && (
        <div className="approve-danger">
          ⚠️ {t('approve.warnFeeBump')}
        </div>
      )}
      {review && !review.maxTime && (
        <div className="approve-danger">
          ⚠️ {t('approve.warnNoExpiry')}
        </div>
      )}

      {needsAck && (
        <label className="approve-ack">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck((e.target as HTMLInputElement).checked)}
            className="approve-ack-box"
          />
          <span className="approve-ack-text">{t('approve.ack')}</span>
        </label>
      )}

      <p className="approve-note">
        {isConnect
          ? t('approve.noteConnect')
          : isPay
            ? t('approve.notePay')
            : t('approve.noteSign')}
      </p>

      {!isConnect && usePasskey && (
        <p className="approve-muted">
          {t('passkey.approveNote')}{' '}
          <button type="button" className="approve-link" onClick={() => setPwdForm(true)}>
            {t('passkey.usePassword')}
          </button>
        </p>
      )}
      {!isConnect && !usePasskey && (
        <input
          type="password"
          value={pwd}
          autoFocus
          placeholder={t('approve.pwdPlaceholder')}
          onChange={(e) => setPwd((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && canApprove && approve()}
          className="approve-input"
        />
      )}

      {err && <div className="approve-error">{err}</div>}

      <div className="approve-actions">
        <Btn kind="reject" onClick={() => respond(req, false, undefined, 'Rejected by the user.')}>{t('approve.reject')}</Btn>
        <Btn kind="approve" onClick={approve} disabled={busy || !canApprove}>
          {busy
            ? isPay
              ? t('approve.sending')
              : t('approve.signing')
            : isConnect
              ? t('approve.connect')
              : isPay
                ? t('approve.send')
                : t('approve.approve')}
        </Btn>
      </div>
    </Frame>
  );
}

/** "in 4 min" / "already expired" / "never", from a unix-second string. */
function expiryLabel(t: TFn, maxTime: string | null): string {
  if (!maxTime) return t('approve.expiryNever');
  const secs = Number(maxTime) - Math.floor(Date.now() / 1000);
  if (!Number.isFinite(secs)) return '—';
  if (secs <= 0) return t('approve.expiryPast');
  if (secs < 90) return t('approve.expirySecs', { n: secs });
  if (secs < 5400) return t('approve.expiryMins', { n: Math.round(secs / 60) });
  return t('approve.expiryHours', { n: Math.round(secs / 3600) });
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="approve-frame">{children}</div>;
}
function Title({ children }: { children: React.ReactNode }) {
  return <h1 className="approve-title">{children}</h1>;
}
function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="approve-row">
      <span className="approve-row-label">{label}</span>
      <span className={cx('approve-row-value', mono && 'approve-mono')}>{value}</span>
    </div>
  );
}
function Btn({ children, onClick, kind, disabled }: { children: React.ReactNode; onClick: () => void; kind: 'approve' | 'reject'; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`approve-btn approve-btn-${kind}`}>
      {children}
    </button>
  );
}
