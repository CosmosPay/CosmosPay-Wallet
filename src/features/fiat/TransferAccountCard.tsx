import { useCallback, useEffect, useId, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { Notice } from '@/ui/Notice';
import { Field } from '@/ui/Field';
import { PrimaryButton, GhostButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { Sheet } from '@/ui/Sheet';
import { Tabs } from '@/ui/Tabs';
import { CloseIcon, CopyIcon } from '@/ui/Icons';
import { useCopied } from '@/hooks/useCopied';
import { TRANSFER_MIN_AGE, type TransferAccountType } from '@/constants/transferAccount';
import { cx } from '@/lib/cx';
import { isDesktopLayout } from '@/lib/layout';
import { openExternal } from '@/lib/openExternal';
import {
  transferAccountProblems,
  transferActivateFailure,
  transferFieldInput,
  transferProblemKey,
  type TransferAccount,
  type TransferAccountDraft,
  type TransferAccountField,
  type TransferAccountRead,
} from '@/lib/transferAccount';
import '@/styles/features/fiat/transfer-account-card.css';

const EMPTY_DRAFT: TransferAccountDraft = {
  type: 'person',
  name: '',
  taxId: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  postalCode: '',
  dateOfBirth: '',
};

/** The badge of each status that has one, and its tone (a class modifier). */
const BADGES: Partial<Record<TransferAccount['status'], { key: string; tone: 'wait' | 'ok' | 'bad' }>> = {
  pending: { key: 'transfer.badgePending', tone: 'wait' },
  in_review: { key: 'transfer.badgeReview', tone: 'wait' },
  approved: { key: 'transfer.badgeActive', tone: 'ok' },
  rejected: { key: 'transfer.badgeRejected', tone: 'bad' },
};

/**
 * "Bank transfers" on the Charge with QR screen (rules in `lib/transferAccount.ts`, calls in
 * `state/useTransferAccount.ts`): the seller's own receiving account, which lets their QR charges
 * also be paid by bank transfer to an alias and CVU in their name.
 *
 * Only for a wallet signed in with a Cosmos Pay account. With the shared public key there is no
 * card, only the line asking to sign in — and not even that unless this deployment offers bank
 * transfers. Then, by status: `none` offers to activate (a sheet with the holder's details),
 * `pending` / `in_review` open the hosted verification in the system browser and refresh,
 * `approved` shows the alias and CVU, `rejected` says why and offers to try again. Coming back to
 * the wallet from the verification page reads the account again.
 */
export function TransferAccountCard({ store }: { store: WalletStore }) {
  const t = store.t;
  const { loadTransferAccount } = store;
  const [read, setRead] = useState<TransferAccountRead | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [form, setForm] = useState<TransferAccountDraft | null>(null);
  const [copied, copy] = useCopied();
  const titleId = useId();

  useEffect(() => {
    let alive = true;
    loadTransferAccount()
      .then((r) => alive && setRead(r))
      .finally(() => alive && setRefreshing(false));
    return () => {
      alive = false;
    };
  }, [loadTransferAccount, attempt]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setAttempt((a) => a + 1);
  }, []);

  // Back from the verification page (another tab, or the system browser): read it again.
  const waiting = read?.kind === 'account' && (read.account.status === 'pending' || read.account.status === 'in_review');
  useEffect(() => {
    if (!waiting) return;
    const back = () => document.visibilityState === 'visible' && refresh();
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => {
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', back);
    };
  }, [waiting, refresh]);

  if (read === null) {
    // The shared key's probe says nothing until it answers: no card that then vanishes.
    if (store.publicAccess) return null;
    return (
      <section className="transfer-card is-loading" aria-busy="true" aria-label={t('transfer.title')}>
        <Spinner tone="text" />
      </section>
    );
  }
  if (read.kind === 'off') return null;
  if (read.kind === 'signin') return <Notice className="transfer-signin">{t('transfer.signIn')}</Notice>;

  const head = (account: TransferAccount | null) => {
    const badge = account ? BADGES[account.status] : undefined;
    return (
      <div className="transfer-head">
        <h2 id={titleId} className="transfer-title">
          {t('transfer.title')}
        </h2>
        {badge && <span className={cx('transfer-badge', `is-${badge.tone}`)}>{t(badge.key)}</span>}
      </div>
    );
  };
  const refreshButton = (
    <GhostButton onClick={refresh} disabled={refreshing}>
      {refreshing ? <Spinner size={16} tone="text" /> : t('transfer.refresh')}
    </GhostButton>
  );

  if (read.kind === 'failed') {
    return (
      <section className="transfer-card" aria-labelledby={titleId}>
        {head(null)}
        <p className="transfer-desc">{t('transfer.loadFailed')}</p>
        <div className="transfer-actions">{refreshButton}</div>
      </section>
    );
  }

  const account = read.account;
  const sheet = (
    <ActivationSheet
      store={store}
      draft={form}
      onDraft={setForm}
      onClose={() => setForm(null)}
      onDone={(next) => {
        setForm(null);
        if (next) setRead({ kind: 'account', account: next });
        else refresh();
      }}
      onSignIn={() => {
        setForm(null);
        setRead({ kind: 'signin' });
      }}
    />
  );
  const startForm = () =>
    setForm({ ...EMPTY_DRAFT, type: account.type ?? 'person', name: account.status === 'rejected' ? account.name ?? '' : '' });

  return (
    <section className="transfer-card" aria-labelledby={titleId}>
      {head(account)}

      {account.status === 'none' && (
        <>
          <p className="transfer-desc">{t('transfer.noneDesc')}</p>
          <div className="transfer-actions">
            <PrimaryButton onClick={startForm}>{t('transfer.activate')}</PrimaryButton>
          </div>
        </>
      )}

      {(account.status === 'pending' || account.status === 'in_review') && (
        <>
          <p className="transfer-desc">{t(account.status === 'pending' ? 'transfer.pendingDesc' : 'transfer.reviewDesc')}</p>
          {!account.verificationUrl && account.status === 'pending' && <p className="transfer-hint">{t('transfer.linkSoon')}</p>}
          <div className="transfer-actions">
            {account.verificationUrl && (
              <PrimaryButton onClick={() => account.verificationUrl && void openExternal(account.verificationUrl)}>
                {t('transfer.verify')}
              </PrimaryButton>
            )}
            {refreshButton}
          </div>
        </>
      )}

      {account.status === 'approved' && (
        <>
          <p className="transfer-desc">{t('transfer.activeDesc')}</p>
          {account.alias || account.cvu ? (
            <dl className="transfer-rows">
              {account.name && (
                <div className="transfer-row">
                  <dt>{t('transfer.holder')}</dt>
                  <dd>{account.name}</dd>
                </div>
              )}
              {[
                { id: 'alias', label: t('transfer.alias'), value: account.alias, aria: t('transfer.copyAlias') },
                { id: 'cvu', label: t('transfer.cvu'), value: account.cvu, aria: t('transfer.copyCvu') },
              ].map(
                (row) =>
                  row.value && (
                    <div key={row.id} className="transfer-row">
                      <dt>{row.label}</dt>
                      <dd className="transfer-mono">
                        <span className="transfer-value">{row.value}</span>
                        <button type="button" className="transfer-copy" aria-label={row.aria} onClick={() => row.value && void copy(row.value, row.id)}>
                          {copied === row.id ? <span className="transfer-copied">{t('common.copied')}</span> : <CopyIcon />}
                        </button>
                      </dd>
                    </div>
                  ),
              )}
            </dl>
          ) : (
            <>
              <p className="transfer-hint">{t('transfer.detailsSoon')}</p>
              <div className="transfer-actions">{refreshButton}</div>
            </>
          )}
        </>
      )}

      {account.status === 'rejected' && (
        <>
          <p className="transfer-desc">{t('transfer.rejectedDesc')}</p>
          {account.reason && <p className="transfer-reason">{t('transfer.reason', { reason: account.reason })}</p>}
          <div className="transfer-actions">
            <PrimaryButton onClick={startForm}>{t('transfer.retry')}</PrimaryButton>
          </div>
        </>
      )}

      {sheet}
    </section>
  );
}

/* ------------------------------ the activation ------------------------------ */

const FIELDS: readonly TransferAccountField[] = ['name', 'taxId', 'email', 'phone', 'address', 'city', 'postalCode', 'dateOfBirth'];

function ActivationSheet({
  store,
  draft,
  onDraft,
  onClose,
  onDone,
  onSignIn,
}: {
  store: WalletStore;
  /** The form while it is open; null when closed. */
  draft: TransferAccountDraft | null;
  onDraft: (next: TransferAccountDraft) => void;
  onClose: () => void;
  /** Activated (the account the API answered), or one already existed (null: read it again). */
  onDone: (account: TransferAccount | null) => void;
  onSignIn: () => void;
}) {
  const t = store.t;
  const titleId = useId();
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [taxIdRefused, setTaxIdRefused] = useState(false);
  const open = draft !== null;

  useEffect(() => {
    if (open) return;
    setTried(false);
    setError('');
    setTaxIdRefused(false);
  }, [open]);

  const d = draft ?? EMPTY_DRAFT;
  const problems = transferAccountProblems(d, Date.now());
  const person = d.type === 'person';
  const errorOf = (field: TransferAccountField): string | undefined => {
    if (field === 'taxId' && taxIdRefused) return t('transfer.errTaxIdServer');
    const p = problems[field];
    return tried && p ? t(transferProblemKey(field, p, d.type), { age: TRANSFER_MIN_AGE }) : undefined;
  };
  const set = (field: TransferAccountField) => (v: string) => {
    if (field === 'taxId') setTaxIdRefused(false);
    onDraft({ ...d, [field]: transferFieldInput(field, v) });
  };
  const setType = (type: TransferAccountType) => {
    setTaxIdRefused(false);
    onDraft({ ...d, type });
  };

  const submit = async () => {
    if (busy || !draft) return;
    setTried(true);
    setError('');
    if (Object.keys(problems).length > 0) {
      setError(t('transfer.formIncomplete'));
      return;
    }
    setBusy(true);
    try {
      onDone(await store.activateTransferAccount(draft));
    } catch (e) {
      const failure = transferActivateFailure(e);
      if (failure.kind === 'taxId') setTaxIdRefused(true);
      else if (failure.kind === 'exists') onDone(null);
      else if (failure.kind === 'signin') onSignIn();
      else setError(t(failure.key));
    } finally {
      setBusy(false);
    }
  };

  const labels: Record<TransferAccountField, string> = {
    name: t(person ? 'transfer.namePerson' : 'transfer.nameCompany'),
    taxId: t(person ? 'transfer.taxIdPerson' : 'transfer.taxIdCompany'),
    email: t('transfer.email'),
    phone: t('transfer.phone'),
    address: t('transfer.address'),
    city: t('transfer.city'),
    postalCode: t('transfer.postalCode'),
    dateOfBirth: t('transfer.dateOfBirth'),
  };
  const placeholders: Partial<Record<TransferAccountField, string>> = {
    taxId: person ? '20-12345678-6' : '30-12345678-1',
    email: t('transfer.emailPlaceholder'),
    phone: '+54 9 387 555 1234',
    address: t('transfer.addressPlaceholder'),
    city: 'Salta',
    postalCode: '4400',
  };
  const types: Record<TransferAccountField, string> = {
    name: 'text',
    taxId: 'text',
    email: 'email',
    phone: 'tel',
    address: 'text',
    city: 'text',
    postalCode: 'text',
    dateOfBirth: 'date',
  };

  return (
    <Sheet open={open} onClose={onClose} labelledBy={titleId} placement={isDesktopLayout() ? 'center' : 'bottom'}>
      <div className="sheet-head">
        <h2 id={titleId} className="sheet-title">
          {t('transfer.formTitle')}
        </h2>
        <button type="button" className="sheet-close ink" aria-label={t('a11y.close')} onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <form className="transfer-form" noValidate onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}>
        <p className="transfer-desc">{t('transfer.formIntro')}</p>
        <Tabs
          tabs={[
            { key: 'person', label: t('transfer.typePerson') },
            { key: 'company', label: t('transfer.typeCompany') },
          ]}
          value={d.type}
          onChange={setType}
          label={t('transfer.typeLabel')}
          className="transfer-type"
        />
        {FIELDS.filter((f) => person || f !== 'dateOfBirth').map((field) => (
          <Field
            key={field}
            label={labels[field]}
            value={d[field]}
            onChange={set(field)}
            type={types[field]}
            placeholder={placeholders[field]}
            tone="soft"
            error={errorOf(field)}
            className="transfer-field"
          />
        ))}
        <Notice className="transfer-form-note">{t('transfer.formNote')}</Notice>
        <PrimaryButton type="submit" disabled={busy} className="transfer-submit">
          {busy ? <Spinner /> : t('common.continue')}
        </PrimaryButton>
        {error && (
          <p className="err-line transfer-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}
