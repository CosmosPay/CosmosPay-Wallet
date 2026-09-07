/**
 * The one error boundary in the app.
 *
 * 33 of the 38 screens are `lazy()`. A dynamic import that fails — chunk hashes
 * rotated by an extension auto-update while the side panel is open, a web build
 * loaded offline, a stale WebView asset cache — rejects past `<Suspense>` and
 * unmounts the root, leaving a blank wallet. Before the split the bundle failed
 * atomically; now it can fail one screen at a time, so a screen-level recovery is
 * what the split actually costs.
 *
 * Copy arrives as props. The store is inside this boundary, so a boundary that
 * called `t()` would be reaching into the thing that may have just thrown.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '@/lib/telemetry';
import { EVENT } from '@/constants/telemetry';
import '@/styles/app/error-boundary.css';

interface Props {
  children: ReactNode;
  title: string;
  message: string;
  reloadLabel: string;
  /**
   * Recovery that does not go through the network. Reloading replays the failure for
   * two of the three causes above (offline build, stale asset cache), and the four
   * tab screens are statically imported — so "go home" is the exit that always works.
   * Absent on the outer boundary, which sits above the store and has no navigation.
   */
  homeLabel?: string;
  onHome?: () => void;
}

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is the trail on the machine that has one. Neither of the two hosts
    // this boundary exists for does: an MV3 popup's console dies with the popup and a
    // phone's WebView console needs a cable, which is why the same failure also goes
    // to the activity feed. `reportError` never throws and never awaits — a boundary
    // that could fail while handling a failure would take the last screen with it.
    console.error('[wallet] render failed', error, info.componentStack);
    reportError(EVENT.renderFailed, error, {
      // The component stack, not the error stack: it names the screen that broke,
      // and it is the wallet's own tree rather than minified chunk offsets. Bounded
      // because the gateway caps a message and a `props` blob alike.
      componentStack: (info.componentStack ?? '').slice(0, 600),
    });
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="col center f1 error-boundary">
        <div className="error-boundary-mark">!</div>
        <h2 className="error-boundary-title">{this.props.title}</h2>
        <p className="desc error-boundary-desc">{this.props.message}</p>
        {this.props.onHome && this.props.homeLabel && (
          <button
            type="button"
            className="btn-primary error-boundary-btn"
            onClick={() => {
              this.setState({ failed: false });
              this.props.onHome?.();
            }}
          >
            {this.props.homeLabel}
          </button>
        )}
        {/* A full reload, not a re-render: `lazy()` caches the rejected import, so
            re-mounting the same screen replays the same failure. */}
        <button type="button" className="btn-ghost error-boundary-btn" onClick={() => location.reload()}>
          {this.props.reloadLabel}
        </button>
      </div>
    );
  }
}
