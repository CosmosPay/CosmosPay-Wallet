import type { ReactNode, MouseEvent } from 'react';
import { isTauri } from '@/lib/platform';
import { openExternal } from '@/lib/openExternal';

/**
 * A link that leaves the wallet — a block explorer, the terms page.
 *
 * Still a real `<a href>`, because on the web it should behave like one: middle-click,
 * "copy link address", and the status bar preview all keep working, and a screen reader
 * still announces a link. What this adds is the one host where the default is not merely
 * different but wrong.
 *
 * IN A TAURI WINDOW `target="_blank"` has nowhere to open: there is no browser chrome to
 * put a tab in, so the engine either ignores the click or — on WebKitGTK and in the
 * Android WebView — follows it IN PLACE. The wallet would navigate itself to a remote page
 * and the document holding the unlocked session would be replaced. The session dies with
 * it, so it is not a key-disclosure bug; it is still an app that vanishes when you tap a
 * link. `openExternal` hands the URL to the OS instead.
 *
 * `stopPropagation` unconditionally, because every one of these sits inside something else
 * that is tappable: the terms link lives in a `CheckRow` whose whole surface toggles a
 * checkbox, and reading the terms must not also tick it.
 */
export function ExternalLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.stopPropagation();
    // Only intercept where the default is broken. A browser tab opens the tab itself, and
    // taking that over would lose the modifier-click behaviours the user expects.
    if (!isTauri()) return;
    e.preventDefault();
    void openExternal(href);
  };

  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={className} onClick={onClick}>
      {children}
    </a>
  );
}
