// Self-contained stylesheet: approve.astro does not load app.css nor the theme
// CSS variables, so this sheet uses literal colors only (see its header).
import '@/styles/components/approve-popup.css';
import { useEffect, useState } from 'react';
import { Keypair } from '@stellar/stellar-sdk';
import { DAPP_MIRROR_KEY, APPROVE_TITLES } from '@/constants/app';
import { getActiveEntry, getNetworkId, getCustomNetworks, unlockWallet, type WalletEntry } from '@/lib/vault';
import { resolveNetwork, signXdr, sendPayment, type NetConfig } from '@/lib/stellar';
import { parseStellarQr, type ParsedQr } from '@/lib/sep7';

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
  if (hasChrome()) {
    try {
      chrome.runtime.sendMessage({ type: 'cosmos-approve-result', id, ok, result, error }, () => void chrome.runtime.lastError);
    } catch {
      /* ignore */
    }
  }
  // Address-bar requests have no page waiting: keep the window open to show the result.
  if (!keepOpen) setTimeout(() => window.close(), 120);
}

export default function ApprovePopup() {
  const [req, setReq] = useState<DappReq | null>(null);
  const [entry, setEntry] = useState<WalletEntry | null>(null);
  const [cfg, setCfg] = useState<NetConfig | null>(null);
  const [pay, setPay] = useState<ParsedQr | null>(null);
  const [payErr, setPayErr] = useState('');
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
      await writeMirror({ address: entry.publicKey, cfg, addOrigin: req.origin });

      if (req.method === 'signTransaction') {
        const signCfg: NetConfig = req.params.networkPassphrase ? { ...cfg, passphrase: req.params.networkPassphrase } : cfg;
        const signedTxXdr = signXdr(signCfg, secret, String(req.params.xdr || ''));
        respond(req.id, true, { signedTxXdr, signerAddress: entry.publicKey });
        return;
      }
      if (req.method === 'signMessage') {
        const sig = Keypair.fromSecret(secret).sign(Buffer.from(String(req.params.message || ''), 'utf8'));
        respond(req.id, true, { signedMessage: sig.toString('base64'), signerAddress: entry.publicKey });
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
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const canApprove = isConnect || (isPay ? !!pay && !!pwd : !!pwd);

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

        {req.method === 'signMessage' && <Row label="Mensaje" value={short(String(req.params.message || ''), 40)} />}
        {req.method === 'signTransaction' && <Row label="Transacción (XDR)" value={short(String(req.params.xdr || ''), 14)} mono />}
      </div>

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
      <span className={`approve-row-value${mono ? ' approve-mono' : ''}`}>{value}</span>
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
