// Self-contained stylesheet: approve.astro does not load app.css nor the theme
// CSS variables, so this sheet uses literal colors only (see its header).
import '@/styles/app/approve-popup.css';
import { useEffect, useMemo, useState } from 'react';
import { Keypair } from '@stellar/stellar-sdk';
import { DAPP_MIRROR_KEY, APPROVE_TITLE_KEYS, OP_LABEL_KEYS } from '@/constants/app';
import { getActiveEntry, getNetworkId, getCustomNetworks, unlockWallet, type WalletEntry } from '@/lib/vault';
import { beginAttempt, blockSeconds, noteAttemptSuccess, releaseAttempt } from '@/lib/attempts';
import { WrongPasswordError } from '@/lib/crypto';
import { resolveNetwork, signXdr, sendPayment, type NetConfig } from '@/lib/stellar';
import { parseStellarQr, type ParsedQr } from '@/lib/sep7';
import { reviewTx, type TxReview } from '@/lib/txGuard';
import { signMessagePayload, SIGN_MESSAGE_DOMAIN } from '@/lib/signMessage';
import { memoKindFromSep7 } from '@/lib/memo';
import { cx } from '@/lib/cx';
import { makeT, savedLang, type TFn } from '@/lib/i18n';

// Extension API — no @types/chrome in this project; the popup only runs as an
// extension page where `chrome` exists (guarded by hasChrome()).
declare const chrome: any;

/**
 * Dapp-approval window (chrome-extension://…/approve/index.html?req=<id>).
 *
 * Opened by the service worker when a page calls window.cosmosWallet.* and needs the
 * user. Self-contained: reuses the vault/stellar libs and shares the wallet's
 * localStorage (same extension origin). No secret ever leaves this window.
 *
 *  - getAddress (connect): consent only — returns the PUBLIC key, remembers the origin.
 *  - signTransaction / signMessage: password -> unlock -> sign locally.
 *  - requestPayment (SEP-7 web+stellar:pay): password -> unlock -> build, sign & submit.
 */

type Method = 'getAddress' | 'signTransaction' | 'signMessage' | 'requestPayment';

interface DappReq {
  id: string;
  origin: string;
  method: Method;
  params: { xdr?: string; message?: string; uri?: string; networkPassphrase?: string };
}

function hasChrome(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.storage;
}

async function loadReq(id: string): Promise<DappReq | null> {
  if (!hasChrome()) return null;
  const key = 'cosmos.req.' + id;
  const o = await chrome.storage.session.get(key);
  return (o[key] as DappReq) || null;
}

/** Keep the SW's read-only mirror in sync (public address + network + approved origins). */
async function writeMirror(patch: { address: string; cfg: NetConfig; addOrigin?: string }) {
  if (!hasChrome()) return;
  const cur = (await chrome.storage.local.get(DAPP_MIRROR_KEY))[DAPP_MIRROR_KEY] || {};
  const approvedOrigins: string[] = Array.isArray(cur.approvedOrigins) ? cur.approvedOrigins : [];
  if (patch.addOrigin && !approvedOrigins.includes(patch.addOrigin)) approvedOrigins.push(patch.addOrigin);
  await chrome.storage.local.set({
    [DAPP_MIRROR_KEY]: {
      address: patch.address,
      networkId: patch.cfg.id,
      networkPassphrase: patch.cfg.passphrase,
      networkUrl: patch.cfg.horizon,
      approvedOrigins,
    },
  });
}

function respond(id: string, ok: boolean, result?: unknown, error?: string, keepOpen = false) {
  if (!hasChrome()) {
    if (!keepOpen) window.close();
    return;
  }
  try {
    // Close only once the SW has acknowledged the message, not on a fixed timer: a
    // cold service-worker start can take longer than a short timeout, and closing
    // early risks the message going out after the sender (this window) is gone.
    chrome.runtime.sendMessage({ type: 'cosmos-approve-result', id, ok, result, error }, () => {
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
  const [loaded, setLoaded] = useState(false);
  const t = useMemo(() => makeT(savedLang()), []);
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  /** Explicit acknowledgement for a takeover-capable or co-signed envelope. */
  const [ack, setAck] = useState(false);
  // Set after an address-bar payment succeeds: keeps the window open showing the hash.
  const [doneHash, setDoneHash] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const id = new URL(window.location.href).searchParams.get('req') || '';
        const [r, e, netId, custom] = await Promise.all([loadReq(id), getActiveEntry(), getNetworkId(), getCustomNetworks()]);
        const c = resolveNetwork(netId, custom);
        setReq(r);
        setEntry(e);
        setCfg(c);
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
        if (e) await writeMirror({ address: e.publicKey, cfg: c }); // keep the SW mirror fresh
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  if (!loaded) return <Frame><p className="approve-muted">{t('approve.loading')}</p></Frame>;
  if (!req) return <Frame><Title>{t('approve.notFound')}</Title><p className="approve-muted">{t('approve.notFoundBody')}</p></Frame>;
  if (!entry || !cfg) {
    return (
      <Frame>
        <Title>{t('approve.noWallet')}</Title>
        <p className="approve-muted">Abre Cosmos Wallet y crea o importa una wallet antes de conectar con una web.</p>
        <Btn kind="reject" onClick={() => respond(req.id, false, undefined, 'No wallet on this device.')}>{t('approve.close')}</Btn>
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

  // Arrow (not a hoisted function declaration) so TS carries the null-narrowing of
  // req/entry/cfg from the early returns above into this closure.
  const approve = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      if (req.method === 'getAddress') {
        await writeMirror({ address: entry.publicKey, cfg, addOrigin: req.origin });
        respond(req.id, true, { address: entry.publicKey });
        return;
      }

      // Everything below needs the secret -> unlock first, and THAT is a password guess
      // like any other. This window was the one path that derived a key from a typed
      // string with no backoff at all: same vault, same PBKDF2 cost, same
      // localStorage, opened on demand by any page calling window.cosmosWallet.* — an
      // unmetered oracle sitting beside the metered ones. `beginAttempt` reserves the
      // guess before the derivation, so concurrent windows cannot all read a clean record.
      const wait = await beginAttempt();
      if (wait > 0) throw new Error(`Demasiados intentos. Espera ${blockSeconds(wait)} s antes de volver a probar.`);
      const { secret } = await unlockWallet(entry.id, pwd).catch(async (e: unknown) => {
        // Only a failed GCM tag is a guess. A missing or unparseable vault blob must not
        // walk the owner up the ladder while the screen blames their password.
        if (!(e instanceof WrongPasswordError)) await releaseAttempt();
        throw e;
      });
      await noteAttemptSuccess();
      // Refresh the public mirror, but do NOT grant the origin here: signing once is
      // not consent to be recognised forever. Only the explicit connect approval
      // (getAddress, above) writes to approvedOrigins.
      await writeMirror({ address: entry.publicKey, cfg });

      if (req.method === 'signTransaction') {
        if (netMismatch) throw new Error(netMismatch);
        if (reviewErr) throw new Error(reviewErr);
        // `cfg` — the wallet's network — and never req.params.networkPassphrase.
        const signedTxXdr = signXdr(cfg, secret, String(req.params.xdr || ''));
        respond(req.id, true, { signedTxXdr, signerAddress: entry.publicKey });
        return;
      }
      if (req.method === 'signMessage') {
        // Sign a domain-separated digest, never the caller's raw bytes — otherwise a
        // 32-byte "message" that is really a transaction hash yields a valid
        // transaction signature. See lib/signMessage.ts.
        const digest = await signMessagePayload(String(req.params.message || ''));
        const sig = Keypair.fromSecret(secret).sign(Buffer.from(digest));
        respond(req.id, true, {
          signedMessage: sig.toString('base64'),
          signerAddress: entry.publicKey,
          domain: SIGN_MESSAGE_DOMAIN,
        });
        return;
      }
      if (req.method === 'requestPayment') {
        if (!pay) throw new Error(payErr || t('approve.badPayLink'));
        const { hash } = await sendPayment({
          cfg,
          secret,
          destination: pay.destination,
          amount: pay.amount || '0',
          memo: pay.memo,
          // The link's memo TYPE has to survive: a MEMO_ID request sent as text
          // arrives unattributed at the payee.
          memoKind: memoKindFromSep7(pay.memoType) ?? 'text',
          asset: pay.assetCode && pay.assetIssuer ? { code: pay.assetCode, issuer: pay.assetIssuer } : null,
        });
        const fromBar = req.origin === 'address-bar';
        respond(req.id, true, { hash, signerAddress: entry.publicKey }, undefined, fromBar);
        if (fromBar) {
          setDoneHash(hash);
          setBusy(false);
        }
        return;
      }
    } catch (e) {
      const wrongPwd = e instanceof WrongPasswordError;
      const message = wrongPwd ? t('confirmSig.wrongPwd') : e instanceof Error ? e.message : String(e);
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
      if (!wrongPwd) respond(req.id, false, undefined, message, true);
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
  const canApprove =
    !netMismatch &&
    !reviewErr &&
    (!needsAck || ack) &&
    (isConnect || (isPay ? !!pay && !!pwd : isSignTx ? !!review && !!pwd : !!pwd));

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

      {!isConnect && (
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
        <Btn kind="reject" onClick={() => respond(req.id, false, undefined, 'Rejected by the user.')}>{t('approve.reject')}</Btn>
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
