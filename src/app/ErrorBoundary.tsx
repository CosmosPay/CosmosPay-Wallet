/**
 * The one error boundary in the app.
 *
 * 33 of the 38 screens are `lazy()`. A dynamic import that fails — chunk hashes
 * rotated by an extension auto-update while the side panel is open, a web build
 * loaded offline, a stale Capacitor asset cache — rejects past `<Suspense>` and
 * unmounts the root, leaving a blank wallet. Before the split the bundle failed
 * atomically; now it can fail one screen at a time, so a screen-level recovery is
 * what the split actually costs.
 *
 * Copy arrives as props. The store is inside this boundary, so a boundary that
 * called `t()` would be reaching into the thing that may have just thrown.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
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
    // Nothing reports for a solo-maintained wallet, so the console is the trail.
    console.error('[wallet] render failed', error, info.componentStack);
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
