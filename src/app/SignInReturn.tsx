import { useEffect, useState } from 'react';
import { SIGN_IN_RETURN_CLOSE_MS } from '@/constants/signIn';
import { tNow } from '@/lib/i18n';
import { browserBindingStore, keepBinding, readSignInReturn } from '@/lib/signInBinding';
import { CosmosMark } from '@/ui/Icons';

/**
 * Where a sign-in started in the web build lands when the browser is done
 * (`src/pages/signed-in.astro`, the server's `returnTo`). It does one thing: after Authentik's
 * emailed link, it leaves the device binding for the tab polling that sign-in
 * (`lib/signInBinding.ts`), then closes itself. A tab the browser will not let a script close
 * (one opened from the mail) stays on this short line; the wallet's own tab carries on alone.
 */
export default function SignInReturn() {
  const [returned] = useState(() => readSignInReturn(location.search, location.hash));

  useEffect(() => {
    // Off the address bar first: the binding is for the wallet, not for a copy-paste.
    history.replaceState(null, '', location.pathname);
    if (returned?.binding) {
      const store = browserBindingStore();
      try {
        if (store) keepBinding(store, returned.state, returned.binding);
      } catch {
        // Storage blocked or full: the claim goes on without it, and the server emails its code.
      }
    }
    const timer = setTimeout(() => window.close(), SIGN_IN_RETURN_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [returned]);

  const failed = !!returned?.error;
  return (
    <main className="signed-in">
      <span className="signed-in-mark">
        <CosmosMark className="signed-in-mark-glyph" />
      </span>
      <h1 className="signed-in-title">{tNow(failed ? 'signedIn.failedTitle' : 'signedIn.title')}</h1>
      <p className="signed-in-lead">{tNow(failed ? 'signedIn.failedDesc' : 'signedIn.desc')}</p>
    </main>
  );
}
