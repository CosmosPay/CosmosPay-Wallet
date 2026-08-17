import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import dataCache from '../lib/cache.ts';

export interface GlobalErrorBoundaryProps {
  children: ReactNode;
  /** Optional callback fired when the user initiates error recovery */
  onReset?: () => void;
  /** Optional custom fallback view */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
}

export interface GlobalErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Global Error Boundary to catch render failures, dynamic import errors,
 * or runtime exceptions in hooks/stores without presenting a blank screen.
 *
 * Provides a recovery action that clears the data cache and resets error boundary
 * state without forcing a hard page reload (window.location.reload).
 */
export class GlobalErrorBoundary extends Component<
  GlobalErrorBoundaryProps,
  GlobalErrorBoundaryState
> {
  public state: GlobalErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): GlobalErrorBoundaryState {
    return {
      hasError: true,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('GlobalErrorBoundary caught error:', error, errorInfo);
  }

  /**
   * Clears corrupted cache state and remounts the children tree.
   */
  public reset = (): void => {
    try {
      dataCache.clear();
    } catch (err) {
      console.error('Failed to clear dataCache on error recovery:', err);
    }

    if (this.props.onReset) {
      try {
        this.props.onReset();
      } catch (err) {
        console.error('Error executing onReset callback:', err);
      }
    }

    this.setState({
      hasError: false,
      error: null,
    });
  };

  public render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback } = this.props;

    if (hasError && error) {
      if (typeof fallback === 'function') {
        return fallback(error, this.reset);
      }
      if (fallback) {
        return fallback;
      }

      return (
        <div
          role="alert"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            width: '100%',
            padding: '24px',
            boxSizing: 'border-box',
            backgroundColor: '#0a0d14',
            color: '#ffffff',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              maxWidth: '420px',
              width: '100%',
              background: '#131823',
              borderRadius: '16px',
              padding: '28px 24px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              border: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px',
                marginBottom: '16px',
              }}
            >
              ⚠️
            </div>
            <h2
              style={{
                fontSize: '20px',
                fontWeight: 600,
                margin: '0 0 8px 0',
                color: '#f3f4f6',
              }}
            >
              Wallet encountered an error
            </h2>
            <p
              style={{
                fontSize: '14px',
                color: '#9ca3af',
                margin: '0 0 20px 0',
                lineHeight: 1.5,
                wordBreak: 'break-word',
              }}
            >
              {error.message || 'An unexpected error occurred.'}
            </p>
            <button
              type="button"
              onClick={this.reset}
              style={{
                width: '100%',
                padding: '12px 20px',
                borderRadius: '10px',
                backgroundColor: '#3b82f6',
                color: '#ffffff',
                fontSize: '15px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
            >
              Recover Wallet State
            </button>
          </div>
        </div>
      );
    }

    return children;
  }
}

export default GlobalErrorBoundary;
