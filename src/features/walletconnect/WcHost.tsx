import { useEffect, useId, useMemo, useState } from 'react';
import type { WalletStore } from '@/state/store';
import type { WcPending } from '@/state/useWalletConnect';
import { EVM_APPROVE_TITLE_KEYS } from '@/constants/evmDapp';
import { evmReviewNotes } from '@/lib/evmReview';
import { evmDappChain } from '@/lib/evmDapp';
import { evmTokenBalanceAt } from '@/lib/chainRpc';
import { networkNameOn } from '@/lib/testnets';
import { shortAddr } from '@/lib/format';
import { isDesktopLayout } from '@/lib/layout';
import { Sheet } from '@/ui/Sheet';
import { Notice } from '@/ui/Notice';
import { CheckRow } from '@/ui/CheckRow';
import { KVRow } from '@/ui/KVRow';
import { PrimaryButton, GhostButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { CloseIcon, LinkIcon } from '@/ui/Icons';
import { WcReview } from '@/features/walletconnect/WcReview';
import '@/styles/features/walletconnect/wc-host.css';

/**
 * Where a site's WalletConnect proposal or request is answered, over whatever screen is open:
 * the oldest waiting one, in a sheet (from the bottom on a phone, in the middle of a PC window).
 * Closed while the signing gate's prompt is up — the sheet is a modal dialog, and the prompt
 * under it would be unreachable — and back when it is answered.
 */
export function WcHost({ store }: { store: WalletStore }) {
  const pending = store.wcPending;
  const titleId = useId();
  if (!pending) return null;
  const open = !store.confirmReq;
  const reject = () => void (pending.kind === 'proposal' ? store.wcRejectProposal(pending.id) : store.wcRejectRequest(pending.id));
  return (
    <Sheet open={open} onClose={reject} labelledBy={titleId} placement={isDesktopLayout() ? 'center' : 'bottom'}>
      {pending.kind === 'proposal' ? (
        <ProposalBody key={`p${pending.id}`} store={store} pending={pending} titleId={titleId} onReject={reject} />
      ) : (
        <RequestBody key={`r${pending.id}`} store={store} pending={pending} titleId={titleId} onReject={reject} />
      )}
    </Sheet>
  );
}

type Proposal = Extract<WcPending, { kind: 'proposal' }>;
type Request = Extract<WcPending, { kind: 'request' }>;

function Head({ store, titleId, title, peer, onReject }: { store: WalletStore; titleId: string; title: string; peer: WcPending['peer']; onReject: () => void }) {
  const t = store.t;
  return (
    <>
      <div className="sheet-head">
        <h2 id={titleId} className="sheet-title">
          {title}
        </h2>
        <button type="button" className="sheet-close ink" aria-label={t('a11y.close')} onClick={onReject}>
          <CloseIcon />
        </button>
      </div>
      <div className="wc-peer">
        <span className="wc-peer-mark" aria-hidden="true">
          <LinkIcon />
        </span>
        <span className="wc-peer-text min0">
          <span className="wc-peer-name">{peer.name || peer.host}</span>
          <span className="wc-peer-host">{peer.host || peer.url}</span>
        </span>
        {store.wcWaiting > 0 && <span className="wc-peer-more">{t('wc.more', { n: store.wcWaiting })}</span>}
      </div>
    </>
  );
}

/** The Verify API's verdict, as the guide asks: a threat blocks, a mismatch and an unknown warn. */
function VerifyNotice({ verify, t }: { verify: WcPending['verify']; t: WalletStore['t'] }) {
  if (verify === 'match') return <p className="wc-verified">{t('wc.verify.match')}</p>;
  return <Notice tone="danger">{t(`wc.verify.${verify}`)}</Notice>;
}

function ProposalBody({ store, pending, titleId, onReject }: { store: WalletStore; pending: Proposal; titleId: string; onReject: () => void }) {
  const t = store.t;
  const [busy, setBusy] = useState(false);
  const account = store.addressOn('eth');
  const blocked = pending.verify === 'threat' || !!pending.problem;
  const approve = async () => {
    setBusy(true);
    await store.wcApproveProposal(pending.id);
    setBusy(false);
  };
  return (
    <div className="wc-body col">
      <Head store={store} titleId={titleId} title={t('wc.proposalTitle')} peer={pending.peer} onReject={onReject} />
      <VerifyNotice verify={pending.verify} t={t} />
      <div className="wc-card">
        <KVRow label={t('approve.evm.rowAccount')} value={account ? shortAddr(account, 8, 6) : '—'} mono />
        <KVRow
          label={t('wc.networks')}
          value={pending.chains.map((id) => {
            const c = evmDappChain(store.chainNet, id);
            return c ? networkNameOn(c.network, store.chainNet) : String(id);
          }).join(', ') || '—'}
        />
      </div>
      <p className="wc-note">{t('wc.proposalNote')}</p>
      {pending.problem && <Notice tone="danger">{t(`wc.problem.${pending.problem}`)}</Notice>}
      <div className="wc-actions">
        <GhostButton onClick={onReject} className="f1">
          {t('approve.reject')}
        </GhostButton>
        <PrimaryButton onClick={() => void approve()} disabled={busy || blocked} className="f1">
          {busy ? <Spinner /> : t('approve.connect')}
        </PrimaryButton>
      </div>
    </div>
  );
}

function RequestBody({ store, pending, titleId, onReject }: { store: WalletStore; pending: Request; titleId: string; onReject: () => void }) {
  const t = store.t;
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const review = pending.review;
  // An allowance on a registry token: the balance it would cover, so one that takes all of it
  // says so — the extension window reads the same (`allowanceCoversAll`).
  const [allowanceBalance, setAllowanceBalance] = useState<bigint | null>(null);
  useEffect(() => {
    const call = review.call;
    if (!review.chain || !review.account || call?.kind !== 'erc20' || !call.grant) return;
    let live = true;
    evmTokenBalanceAt(review.chain.rpc, call.token.asset, review.account)
      .then((b) => live && setAllowanceBalance(b))
      .catch(() => live && setAllowanceBalance(null));
    return () => {
      live = false;
    };
  }, [review]);
  const notes = useMemo(() => evmReviewNotes(review, allowanceBalance), [review, allowanceBalance]);
  const blocked = pending.verify === 'threat' || !!review.refusal || !review.request;
  const send = review.request?.kind === 'sendTransaction';
  const approve = async () => {
    setBusy(true);
    await store.wcApproveRequest(pending.id, ack);
    setBusy(false);
  };
  return (
    <div className="wc-body col">
      <Head store={store} titleId={titleId} title={t(EVM_APPROVE_TITLE_KEYS[review.method] ?? 'approve.evm.title.unknown')} peer={pending.peer} onReject={onReject} />
      <VerifyNotice verify={pending.verify} t={t} />
      <div className="wc-scroll">
        <WcReview review={review} notes={notes} t={t} />
      </div>
      {notes.needsAck && !blocked && (
        <CheckRow on={ack} onToggle={() => setAck((a) => !a)} className="wc-ack">
          {t('approve.evm.ack')}
        </CheckRow>
      )}
      <p className="wc-note">{t(send ? 'approve.evm.noteSend' : 'approve.noteSign')}</p>
      <div className="wc-actions">
        <GhostButton onClick={onReject} className="f1">
          {t('approve.reject')}
        </GhostButton>
        <PrimaryButton onClick={() => void approve()} disabled={busy || blocked || (notes.needsAck && !ack)} className="f1">
          {busy ? <Spinner /> : t(send ? 'approve.send' : 'approve.approve')}
        </PrimaryButton>
      </div>
    </div>
  );
}
