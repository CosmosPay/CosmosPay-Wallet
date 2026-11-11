import { ERC20_FN_KEYS, type Erc20Function } from '@/constants/evmDapp';
import { formatUnits, messagePreview, typedDataChainId, type CallReview } from '@/lib/evmDapp';
import type { EvmReview, EvmReviewNotes } from '@/lib/evmReview';
import { networkDefOn, networkNameOn, sendFeeReserveOn } from '@/lib/testnets';
import { shortAddr } from '@/lib/format';
import { cx } from '@/lib/cx';
import { KVRow } from '@/ui/KVRow';
import { Notice } from '@/ui/Notice';
import '@/styles/features/walletconnect/wc-review.css';

type TFn = (key: string, params?: Record<string, string | number>) => string;

/**
 * What a site asked through WalletConnect, in rows: the network and account, then the
 * transaction (recipient, value, the fee cap, the call decoded into words where it is a registry
 * token's ERC-20 call, otherwise the raw selector and data), the message, or the typed data as it
 * will be signed (domain, primary type, the parsed message — never the raw params). The reading
 * and the warnings are `lib/evmReview.ts`, the same as the extension's approval window.
 */
export function WcReview({ review, notes, t }: { review: EvmReview; notes: EvmReviewNotes; t: TFn }) {
  const { request, chain, env, call } = review;
  const def = chain ? networkDefOn(chain.network, env) : null;
  const coin = def?.coin ?? '';
  const decimals = def?.decimals ?? 18;
  const tx = request?.kind === 'sendTransaction' ? request.tx : null;
  const typed = request?.kind === 'signTypedData' ? request.typed : null;
  const message = request?.kind === 'personalSign' ? messagePreview(request.message) : null;
  const domainChain = typed ? typedDataChainId(typed) : null;
  const short = (a: string) => shortAddr(a, 8, 6);
  const amountLabel = (c: Extract<CallReview, { kind: 'erc20' }>) =>
    c.unlimited ? t('approve.evm.unlimited') : `${formatUnits(c.amount, c.token.decimals)} ${c.token.symbol}`;
  const counterpartyLabel = (fn: Erc20Function) => t(fn === 'approve' || fn === 'increaseAllowance' ? 'approve.evm.rowSpender' : 'approve.evm.rowRecipient');

  return (
    <div className="wc-review col">
      <div className="wc-review-card">
        <KVRow label={t('approve.rowNetwork')} value={chain ? networkNameOn(chain.network, env) : '—'} />
        <KVRow label={t('approve.evm.rowAccount')} value={review.account ? short(review.account) : '—'} mono />
        {tx && chain && (
          <>
            <KVRow label={t('approve.evm.rowTo')} value={short(tx.to)} mono />
            <KVRow label={t('approve.evm.rowValue')} value={`${formatUnits(tx.value, decimals)} ${coin}`} />
            <KVRow label={t('approve.evm.rowFeeCap')} value={`${formatUnits(sendFeeReserveOn(chain.network, env), decimals)} ${coin}`} />
          </>
        )}
      </div>

      {call?.kind === 'erc20' && (
        <div className={cx('wc-review-op', (call.grant || call.fn === 'transferFrom') && 'is-critical')}>
          <div className="wc-review-op-type">{t(ERC20_FN_KEYS[call.fn])}</div>
          <KVRow label={t('approve.evm.rowToken')} value={call.token.symbol} />
          {call.owner && <KVRow label={t('approve.evm.rowOwner')} value={short(call.owner)} mono />}
          <KVRow label={counterpartyLabel(call.fn)} value={short(call.counterparty)} mono />
          <KVRow label={t('approve.evm.rowAmount')} value={amountLabel(call)} />
        </div>
      )}
      {call?.kind === 'contract' && tx && (
        <div className="wc-review-op is-critical">
          <div className="wc-review-op-type">{t('approve.evm.contractCall')}</div>
          <KVRow label={t('approve.evm.rowSelector')} value={call.selector} mono />
          <KVRow label={t('approve.evm.rowDataSize')} value={t('approve.evm.bytes', { n: String(call.bytes) })} />
          {/* What the arguments would mean for an honest ERC-20: a hint, the contract decides. */}
          {call.erc20 && (
            <>
              <KVRow label={t('approve.evm.looksLike')} value={t(ERC20_FN_KEYS[call.erc20.fn])} />
              {call.erc20.owner && <KVRow label={t('approve.evm.rowOwner')} value={short(call.erc20.owner)} mono />}
              <KVRow label={counterpartyLabel(call.erc20.fn)} value={short(call.erc20.counterparty)} mono />
              <KVRow
                label={t('approve.evm.rowAmount')}
                value={call.erc20.unlimited ? t('approve.evm.unlimited') : t('approve.evm.rawUnits', { n: call.erc20.amount.toString() })}
              />
            </>
          )}
          <pre className="wc-review-raw">{tx.data}</pre>
        </div>
      )}

      {message && (
        <div className="wc-review-block">
          <div className="wc-review-label">{t(message.hex ? 'approve.evm.messageHex' : 'approve.messageToSign')}</div>
          <pre className="wc-review-raw">{message.text}</pre>
        </div>
      )}

      {typed && (
        <div className="wc-review-block">
          <div className="wc-review-card">
            {typeof typed.domain.name === 'string' && <KVRow label={t('approve.evm.rowDomain')} value={typed.domain.name} />}
            {typeof typed.domain.version === 'string' && <KVRow label={t('approve.evm.rowVersion')} value={typed.domain.version} />}
            {domainChain !== null && <KVRow label={t('approve.evm.rowChainId')} value={String(domainChain)} />}
            {typeof typed.domain.verifyingContract === 'string' && (
              <KVRow label={t('approve.evm.rowContract')} value={short(typed.domain.verifyingContract)} mono />
            )}
            <KVRow label={t('approve.evm.rowPrimaryType')} value={typed.primaryType} mono />
          </div>
          <div className="wc-review-label">{t('approve.evm.typedMessage')}</div>
          <pre className="wc-review-raw">{JSON.stringify(typed.message, null, 2)}</pre>
        </div>
      )}

      {review.refusal && <Notice tone="danger">{t(review.refusal)}</Notice>}
      {notes.warnings.map((w) => (
        <Notice key={w.key} tone="danger">
          {t(w.key, w.params)}
        </Notice>
      ))}
    </div>
  );
}
