// Self-contained stylesheet: approve.astro does not load app.css nor the theme
// CSS variables, so this sheet uses literal colors only (see its header).
import '@/styles/app/approve-popup.css';
import { useEffect, useState } from 'react';
import { Keypair } from '@stellar/stellar-sdk';
import { DAPP_MIRROR_KEY, APPROVE_TITLES, OP_LABELS } from '@/constants/app';
import { getActiveEntry, getNetworkId, getCustomNetworks, unlockWallet, type WalletEntry } from '@/lib/vault';
import { resolveNetwork, signXdr, sendPayment, type NetConfig } from '@/lib/stellar';
import { parseStellarQr, type ParsedQr } from '@/lib/sep7';
import { reviewTx, type TxReview } from '@/lib/txGuard';
import { signMessagePayload, SIGN_MESSAGE_DOMAIN } from '@/lib/signMessage';
import { memoKindFromSep7 } from '@/lib/memo';
import { cx } from '@/lib/cx';

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
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
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
          else setPayErr('El enlace SEP-7 no contiene un pago válido.');
        }
        if (r && r.method === 'signTransaction') {
          // A dapp may state which network it built for, but it does NOT get to
          // choose the one we sign against: the passphrase is not carried inside the
          // envelope, so accepting theirs is what lets a "Testnet" approval produce a
          // valid mainnet signature. Mismatch => refuse, don't silently re-target.
          const asked = String(r.params.networkPassphrase || '');
          if (asked && asked !== c.passphrase) {
            setNetMismatch(
              `La web pide firmar en una red distinta a la tuya (${c.label}). Cambia de red en la wallet si realmente quieres operar ahí.`,
            );
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

  if (!loaded) return <Frame><p className="approve-muted">Cargando…</p></Frame>;
  if (!req) return <Frame><Title>Solicitud no encontrada</Title><p className="approve-muted">La solicitud caducó o ya se resolvió. Puedes cerrar esta ventana.</p></Frame>;
  if (!entry || !cfg) {
    return (
      <Frame>
        <Title>No hay wallet</Title>
        <p className="approve-muted">Abre Cosmos Wallet y crea o importa una wallet antes de conectar con una web.</p>
        <Btn kind="reject" onClick={() => respond(req.id, false, undefined, 'No hay wallet en este dispositivo.')}>Cerrar</Btn>
      </Frame>
    );
  }

  const isConnect = req.method === 'getAddress';
  const isPay = req.method === 'requestPayment';
  const short = (s: string, n = 10) => (s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);
  const payAsset = pay ? (pay.assetCode && pay.assetIssuer ? pay.assetCode : 'XLM') : '';
  const originLabel = req.origin === 'address-bar' ? 'Barra de direcciones' : req.origin;

  if (doneHash) {
    return (
      <Frame>
        <Title>Pago enviado ✓</Title>
        <div className="approve-card">
          <Row label="Hash" value={short(doneHash, 12)} mono />
          <Row label="Red" value={cfg.label} />
        </div>
        <p className="approve-success">La transacción se firmó en tu dispositivo y se envió a la red.</p>
        <Btn kind="approve" onClick={() => window.close()}>Cerrar</Btn>
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

      // everything below needs the secret -> unlock first
      const { secret } = await unlockWallet(entry.id, pwd); // throws "Contraseña incorrecta." on bad pwd
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
        if (!pay) throw new Error(payErr || 'Enlace de pago inválido.');
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
      const message = e instanceof Error ? e.message : String(e);
      setErr(message);
      setBusy(false);
      // A wrong password is retryable — leave the request pending so the user can just
      // try again. Anything else (malformed XDR, a failed payment build/submit, a
      // missing vault entry, …) is terminal: nothing will ever retry it, so without a
      // reply here the dapp's promise would hang forever. Keep the window open so the
      // user still sees the message; respond() unblocks the dapp regardless.
      if (message !== 'Contraseña incorrecta.') respond(req.id, false, undefined, message, true);
    }
  };

  // A transaction the window could not decode — or one aimed at another network —
  // is never approvable: the only honest action left is Reject.
  const isSignTx = req.method === 'signTransaction';
  const foreignSource = !!review && review.source !== entry.publicKey;
  const canApprove =
    !netMismatch &&
    !reviewErr &&
    (isConnect || (isPay ? !!pay && !!pwd : isSignTx ? !!review && !!pwd : !!pwd));

  return (
    <Frame>
      <div className="approve-origin">
        <div className="approve-origin-label">Solicitud de</div>
        <div className="approve-origin-host">{originLabel}</div>
      </div>

      <Title>{APPROVE_TITLES[req.method]}</Title>

      <div className="approve-card">
        <Row label="Wallet" value={entry.name || 'astronauta'} />
        <Row label="Tu dirección" value={short(entry.publicKey)} mono />
        <Row label="Red" value={cfg.label} />

        {isPay && pay && (
          <>
            <div className="approve-divider" />
            <Row label="Enviar a" value={short(pay.destination)} mono />
            <Row label="Importe" value={`${pay.amount || '—'} ${payAsset}`} />
            {pay.memo && <Row label="Memo" value={pay.memo} />}
          </>
        )}
        {isPay && payErr && <div className="approve-pay-error">{payErr}</div>}

        {req.method === 'signMessage' && (
          <>
            <div className="approve-divider" />
            <div className="approve-row-label">Mensaje a firmar</div>
            <div className="approve-msg">{String(req.params.message || '')}</div>
          </>
        )}

        {req.method === 'signTransaction' && review && (
          <>
            <div className="approve-divider" />
            {/* The window used to decode `source`, `feeBumpSource`, `sequence` and
                `signatures` and then render none of them: it consumed only
                `hasCritical`. Everything the envelope commits you to is shown. */}
            <Row label="Origen" value={foreignSource ? short(review.source) : 'Tu cuenta'} mono={foreignSource} />
            <Row label="Comisión" value={`${review.feeXlm} XLM`} />
            <Row label="Secuencia" value={review.sequence || '—'} mono />
            <Row label="Caduca" value={expiryLabel(review.maxTime)} />
            {review.signatures > 0 && <Row label="Firmas ya presentes" value={String(review.signatures)} />}
            {review.feeBumpSource && <Row label="Fee-bump de" value={short(review.feeBumpSource)} mono />}
            {review.memo && <Row label="Memo" value={`${review.memo} (${review.memoType})`} />}
            <div className="approve-ops">
              {review.operations.map((op, i) => (
                <div key={i} className={cx('approve-op', op.critical && 'is-critical')}>
                  <div className="approve-op-type">
                    {i + 1}. {OP_LABELS[op.type] ?? op.type}
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
      {reviewErr && <div className="approve-danger">⛔ No se pudo leer la transacción: {reviewErr}</div>}
      {review?.hasCritical && (
        <div className="approve-danger">
          ⚠️ Esta transacción incluye una operación que puede dar control de tu cuenta a un tercero, o invoca un contrato que esta ventana no puede leer. No la apruebes salvo que sepas exactamente qué estás haciendo.
        </div>
      )}
      {foreignSource && (
        <div className="approve-danger">
          ⚠️ Esta transacción no sale de tu cuenta. Tu firma se añadiría a la de otra persona.
        </div>
      )}
      {review?.feeBumpSource && (
        <div className="approve-danger">
          ⚠️ Es un envoltorio fee-bump: un tercero paga la comisión y decide cuándo reenviarla.
        </div>
      )}
      {review && !review.maxTime && (
        <div className="approve-danger">
          ⚠️ Esta transacción no caduca nunca. Una vez firmada, quien la tenga puede enviarla en cualquier momento.
        </div>
      )}

      <p className="approve-note">
        {isConnect
          ? 'Se compartirá tu dirección pública con esta web. No se expone ninguna clave.'
          : isPay
            ? 'Se construirá, firmará y enviará este pago desde tu wallet. Revisa el destino y el importe.'
            : 'La firma se hace en tu dispositivo con tu clave; nunca sale de aquí.'}
      </p>

      {!isConnect && (
        <input
          type="password"
          value={pwd}
          autoFocus
          placeholder="Contraseña de la wallet"
          onChange={(e) => setPwd((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && canApprove && approve()}
          className="approve-input"
        />
      )}

      {err && <div className="approve-error">{err}</div>}

      <div className="approve-actions">
        <Btn kind="reject" onClick={() => respond(req.id, false, undefined, 'Rechazado por el usuario.')}>Rechazar</Btn>
        <Btn kind="approve" onClick={approve} disabled={busy || !canApprove}>
          {busy ? (isPay ? 'Enviando…' : 'Firmando…') : isConnect ? 'Conectar' : isPay ? 'Enviar' : 'Aprobar'}
        </Btn>
      </div>
    </Frame>
  );
}

/** "en 4 min" / "hace 2 min" / "sin caducidad", from a unix-second string. */
function expiryLabel(maxTime: string | null): string {
  if (!maxTime) return 'Nunca (sin caducidad)';
  const secs = Number(maxTime) - Math.floor(Date.now() / 1000);
  if (!Number.isFinite(secs)) return '—';
  if (secs <= 0) return 'Ya ha caducado';
  if (secs < 90) return `en ${secs} s`;
  if (secs < 5400) return `en ${Math.round(secs / 60)} min`;
  return `en ${Math.round(secs / 3600)} h`;
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
