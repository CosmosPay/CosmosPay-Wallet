import { useState } from 'react';
import type { WalletStore } from '../store';
import { C, PrimaryButton, BackBar, Spinner } from '../parts';
import { Field } from './Onboarding';
import { copyText } from '../../lib/clipboard';
import { shortAddr } from '../../lib/format';
import { NETWORKS, type StellarNetwork } from '../../lib/stellar';
import { changePassword } from '../../lib/vault';
import { LANGUAGES } from '../../lib/i18n';

export function Settings({ store }: { store: WalletStore }) {
  const t = store.t;
  const pub = store.meta?.publicKey ?? '';
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  const copy = async () => {
    await copyText(pub);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 20px 40px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('settings.title')} onBack={() => store.go(store.session ? 'profile' : 'home', 'profile')} />

      <Section title={t('settings.network')}>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['testnet', 'public'] as StellarNetwork[]).map((net) => {
            const on = store.network === net;
            return (
              <button key={net} onClick={() => store.switchNetwork(net)} style={{ flex: 1, background: on ? C.accent : C.cardSolid, color: on ? 'var(--on-accent)' : 'var(--text)', border: 'none', borderRadius: '14px', padding: '14px', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                {NETWORKS[net].label}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: '12px', color: C.dim, fontWeight: 600, marginTop: '10px', lineHeight: 1.5 }}>
          {t('settings.networkDesc')}
        </div>
      </Section>

      <Section title={t('settings.appearance')}>
        <div style={{ display: 'flex', gap: '8px' }}>
          {([['dark', t('settings.dark'), '🌙'], ['light', t('settings.light'), '☀️']] as const).map(([th, label, icon]) => {
            const on = store.theme === th;
            return (
              <button key={th} onClick={() => store.setTheme(th)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: on ? C.accent : C.cardSolid, color: on ? 'var(--on-accent)' : 'var(--text)', border: 'none', borderRadius: '14px', padding: '14px', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
                <span>{icon}</span>{label}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title={t('settings.language')}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {LANGUAGES.map((l) => {
            const on = store.lang === l.code;
            return (
              <button key={l.code} onClick={() => store.setLang(l.code)} style={{ display: 'flex', alignItems: 'center', gap: '7px', background: on ? C.accent : C.cardSolid, color: on ? 'var(--on-accent)' : 'var(--text)', border: 'none', borderRadius: '999px', padding: '10px 16px', fontSize: '13.5px', fontWeight: 800, cursor: 'pointer' }}>
                <span>{l.flag}</span>{l.name}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title={t('settings.myAddress')}>
        <div onClick={copy} className="tap" style={{ ...C.glass, borderRadius: '14px', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'monospace' }}>{shortAddr(pub, 10, 10)}</span>
          <span style={{ fontSize: '12px', fontWeight: 800, color: copied ? C.accent : C.muted }}>{copied ? t('common.copied') : t('common.copy')}</span>
        </div>
      </Section>

      <Section title={t('settings.security')}>
        <Row label={t('settings.exportPhrase')} onClick={() => store.setScreen('export')} />
        <Row label={pwOpen ? t('settings.cancelChangePwd') : t('settings.changePwd')} onClick={() => setPwOpen((o) => !o)} last={!pwOpen} />
        {pwOpen && <ChangePassword store={store} onDone={() => setPwOpen(false)} />}
      </Section>

      <Section title={t('settings.danger')}>
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} style={{ width: '100%', background: 'rgba(255,93,93,.10)', color: C.danger, border: '1px solid rgba(255,93,93,.24)', borderRadius: '14px', padding: '15px', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
            {t('settings.deleteThis')}
          </button>
        ) : (
          <div style={{ background: 'rgba(255,93,93,.08)', border: '1px solid rgba(255,93,93,.24)', borderRadius: '16px', padding: '16px' }}>
            <div style={{ fontSize: '13px', color: '#ffb3b3', fontWeight: 600, lineHeight: 1.5, marginBottom: '12px' }}>
              {t('settings.deleteConfirm', { name: store.meta?.name ?? '' })}
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setConfirmDelete(false)} style={{ flex: 1, ...C.glassSoft, color: 'var(--text)', border: 'none', borderRadius: '12px', padding: '13px', fontWeight: 800, cursor: 'pointer' }}>{t('common.cancel')}</button>
              <button onClick={() => store.removeActiveWallet()} style={{ flex: 1, background: C.danger, color: '#fff', border: 'none', borderRadius: '12px', padding: '13px', fontWeight: 800, cursor: 'pointer' }}>{t('common.delete')}</button>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

function ChangePassword({ store, onDone }: { store: WalletStore; onDone: () => void }) {
  const t = store.t;
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = cur.length > 0 && next.length >= 8 && !busy;

  const submit = async () => {
    setBusy(true);
    try {
      await changePassword(cur, next);
      store.flash(t('settings.pwdUpdated'), 'ok');
      onDone();
    } catch (e) {
      store.flash((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: '12px' }}>
      <Field label={t('settings.currentPwd')} value={cur} onChange={setCur} type="password" placeholder={t('settings.currentPwd')} />
      <Field label={t('settings.newPwd')} value={next} onChange={setNext} type="password" placeholder={t('pwd.min')} />
      <PrimaryButton disabled={!ok} onClick={submit}>{busy ? <Spinner /> : t('settings.savePwd')}</PrimaryButton>
    </div>
  );
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <div style={{ marginTop: '22px' }}>
      <div style={{ fontSize: '12px', color: C.dim, fontWeight: 700, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '.5px' }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, onClick, last }: { label: string; onClick: () => void; last?: boolean }) {
  return (
    <div onClick={onClick} className="tap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...C.glass, borderRadius: '14px', padding: '15px 16px', cursor: 'pointer', marginBottom: last ? 0 : '10px' }}>
      <span style={{ fontSize: '15px', fontWeight: 700 }}>{label}</span>
      <span style={{ color: '#4f5754', fontSize: '18px' }}>›</span>
    </div>
  );
}

/* ------------------------------ EXPORT ------------------------------ */
export function Export({ store }: { store: WalletStore }) {
  const t = store.t;
  const [pwd, setPwd] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');

  const unlock = async () => {
    setBusy(true);
    const ok = await store.checkPassword(pwd);
    setBusy(false);
    if (ok) setRevealed(true);
    else store.flash(t('pwd.label') + ' ✗', 'err');
  };

  const copy = async (label: string, value: string) => {
    await copyText(value);
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(''), 1500);
  };

  const mnemonic = store.session?.mnemonic ?? null;
  const secret = store.session?.secret ?? '';

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 30px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('export.title')} onBack={() => store.go(store.session ? 'profile' : 'home', 'profile')} />

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', background: 'rgba(255,93,93,.10)', border: '1px solid rgba(255,93,93,.24)', borderRadius: '14px', padding: '14px', margin: '14px 0 20px' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}><path d="M12 3l9 16H3l9-16z" stroke="#ff7a7a" strokeWidth="1.8" strokeLinejoin="round" /><path d="M12 10v4M12 17h.01" stroke="#ff7a7a" strokeWidth="1.8" strokeLinecap="round" /></svg>
        <span style={{ fontSize: '12.5px', color: '#ffb3b3', fontWeight: 600, lineHeight: 1.45 }}>
          {t('export.warning')}
        </span>
      </div>

      {!revealed ? (
        <>
          <div style={{ fontSize: '14px', color: C.muted, fontWeight: 600, lineHeight: 1.5, marginBottom: '18px' }}>
            {t('export.enterPwd')}
          </div>
          <input type="password" value={pwd} placeholder={t('pwd.label')} onChange={(e) => setPwd((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && unlock()} style={{ width: '100%', ...C.glass, borderRadius: '14px', padding: '15px 16px', color: 'var(--text)', fontSize: '15px', fontWeight: 600, outline: 'none', marginBottom: '18px' }} />
          <PrimaryButton disabled={!pwd || busy} onClick={unlock}>{busy ? <Spinner /> : t('export.reveal')}</PrimaryButton>
        </>
      ) : (
        <>
          {mnemonic ? (
            <Reveal title={t('export.phraseTitle')} value={mnemonic} mono={false} copyLabel={t('common.copy')} copiedLabel={t('common.copied')} copied={copiedKey === 'phrase'} onCopy={() => copy('phrase', mnemonic)} grid />
          ) : (
            <div style={{ ...C.glass, borderRadius: '14px', padding: '14px', fontSize: '12.5px', color: C.muted, fontWeight: 600, marginBottom: '16px', lineHeight: 1.5 }}>
              {t('export.noPhrase')}
            </div>
          )}
          <Reveal title={t('export.secretTitle')} value={secret} mono copyLabel={t('common.copy')} copiedLabel={t('common.copied')} copied={copiedKey === 'secret'} onCopy={() => copy('secret', secret)} />
          <div style={{ fontSize: '12px', color: C.dim, fontWeight: 600, lineHeight: 1.5, marginTop: '4px' }}>
            {t('export.compat')}
          </div>
        </>
      )}
    </div>
  );
}

function Reveal({ title, value, mono, copied, onCopy, grid, copyLabel, copiedLabel }: { title: string; value: string; mono: boolean; copied: boolean; onCopy: () => void; grid?: boolean; copyLabel: string; copiedLabel: string }) {
  return (
    <div style={{ marginBottom: '18px' }}>
      <div style={{ fontSize: '12px', color: C.dim, fontWeight: 700, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '.5px' }}>{title}</div>
      {grid ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
          {value.split(' ').map((w, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', ...C.glass, borderRadius: '11px', padding: '10px 12px' }}>
              <span style={{ fontSize: '11px', color: C.accent, fontWeight: 700, width: '14px' }}>{i + 1}</span>
              <span style={{ fontSize: '14px', fontWeight: 700 }}>{w}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ ...C.glass, borderRadius: '14px', padding: '14px', fontSize: '13px', fontWeight: 600, wordBreak: 'break-all', lineHeight: 1.5, fontFamily: mono ? 'monospace' : 'inherit', marginBottom: '10px' }}>{value}</div>
      )}
      <button onClick={onCopy} style={{ width: '100%', ...C.glassSoft, color: copied ? C.accent : 'var(--text)', border: 'none', borderRadius: '12px', padding: '12px', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>{copied ? copiedLabel : copyLabel}</button>
    </div>
  );
}
