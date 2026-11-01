import type { WalletStore } from '@/state/store';
import { Notice } from '@/ui/Notice';
import '@/styles/features/onboarding/sign-in-conflict.css';

/**
 * The server refused to create this sign-in's wallet: the account backed one up from another
 * device in the meantime. Said on the step where it happened, with the one way on — the
 * sign-in again, which finds that backup and restores it. Nothing moves the person off this
 * step until they choose to go.
 */
export function SignInConflict({ store, className }: { store: WalletStore; className?: string }) {
  if (!store.signInConflict) return null;
  const t = store.t;
  const again = () => {
    store.backTo('sign-in');
    store.cancelSignIn();
  };
  return (
    <Notice tone="danger" className={className}>
      <span>{t('signin.conflict')}</span>
      <button type="button" className="link-btn sign-in-conflict-again" onClick={again}>
        {t('signin.signInAgain')}
      </button>
    </Notice>
  );
}
