import '../test-setup.ts';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import dataCache from '../lib/cache.ts';
import { GlobalErrorBoundary } from './GlobalErrorBoundary.tsx';

/**
 * Dummy component that throws an error conditionally to test error boundary behavior.
 */
function BuggyComponent({ shouldThrow, errorMessage }: { shouldThrow: boolean; errorMessage?: string }) {
  if (shouldThrow) {
    throw new Error(errorMessage || 'Crash in store/hook data stream');
  }
  return <div data-testid="child-content">Wallet Running Smoothly</div>;
}

describe('GlobalErrorBoundary', () => {
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    dataCache.clear();
    // Suppress expected error logs from React and error boundary during intentional throw tests
    originalConsoleError = console.error;
    console.error = () => {};
  });

  afterEach(() => {
    cleanup();
    console.error = originalConsoleError;
  });

  it('renders children normally when no error is thrown (Happy Path)', () => {
    render(
      <GlobalErrorBoundary>
        <BuggyComponent shouldThrow={false} />
      </GlobalErrorBoundary>
    );

    const child = screen.getByTestId('child-content');
    assert.ok(child);
    assert.equal(child.textContent, 'Wallet Running Smoothly');
    assert.equal(screen.queryByRole('alert'), null);
  });

  it('catches thrown errors and renders a recovery screen with message and action button', () => {
    render(
      <GlobalErrorBoundary>
        <BuggyComponent
          shouldThrow={true}
          errorMessage="Failed dynamic import / store corrupt"
        />
      </GlobalErrorBoundary>
    );

    // Verify recovery screen is shown instead of blank page
    const alert = screen.getByRole('alert');
    assert.ok(alert, 'Recovery alert container must be present');

    assert.ok(screen.getByText('Wallet encountered an error'));
    assert.ok(screen.getByText('Failed dynamic import / store corrupt'));

    const recoverButton = screen.getByRole('button', {
      name: 'Recover Wallet State',
    });
    assert.ok(recoverButton);
  });

  it('executes recovery action: calls dataCache.clear() and resets error boundary state', () => {
    let clearCalled = 0;
    const originalClear = dataCache.clear.bind(dataCache);
    dataCache.clear = () => {
      clearCalled++;
      return originalClear();
    };

    // Pre-populate data cache with some state
    dataCache.set('testnet:GUSER:balances', { xlm: '100' });
    assert.equal(dataCache.size, 1);

    function StatefulWrapper() {
      const [hasError, setHasError] = useState(true);

      return (
        <GlobalErrorBoundary
          onReset={() => {
            // Fix the error condition so remount succeeds
            setHasError(false);
          }}
        >
          <BuggyComponent
            shouldThrow={hasError}
            errorMessage="Temporary network crash"
          />
        </GlobalErrorBoundary>
      );
    }

    render(<StatefulWrapper />);

    // 1. Verify error boundary is currently catching the error
    assert.ok(screen.getByText('Wallet encountered an error'));
    assert.ok(screen.getByText('Temporary network crash'));

    // 2. Click "Recover Wallet State" button
    const recoverButton = screen.getByRole('button', {
      name: 'Recover Wallet State',
    });
    fireEvent.click(recoverButton);

    // 3. Verify dataCache.clear() was called to wipe corrupted state
    assert.equal(clearCalled, 1, 'dataCache.clear() must be invoked on recovery');
    assert.equal(dataCache.size, 0, 'dataCache must be emptied');

    // 4. Verify boundary recovered and child component is remounted
    assert.equal(screen.queryByRole('alert'), null);
    const child = screen.getByTestId('child-content');
    assert.ok(child);
    assert.equal(child.textContent, 'Wallet Running Smoothly');

    // Restore original method
    dataCache.clear = originalClear;
  });

  it('triggers custom onReset prop callback when recovery button is clicked', () => {
    let onResetFired = false;

    render(
      <GlobalErrorBoundary
        onReset={() => {
          onResetFired = true;
        }}
      >
        <BuggyComponent shouldThrow={true} errorMessage="Fatal hook error" />
      </GlobalErrorBoundary>
    );

    const recoverButton = screen.getByRole('button', {
      name: 'Recover Wallet State',
    });
    fireEvent.click(recoverButton);

    assert.equal(onResetFired, true, 'onReset prop callback must be called');
  });

  it('supports custom fallback render function if provided', () => {
    render(
      <GlobalErrorBoundary
        fallback={(error, reset) => (
          <div data-testid="custom-fallback">
            <span>Custom Error: {error.message}</span>
            <button onClick={reset}>Try Again</button>
          </div>
        )}
      >
        <BuggyComponent shouldThrow={true} errorMessage="Custom throw" />
      </GlobalErrorBoundary>
    );

    assert.ok(screen.getByTestId('custom-fallback'));
    assert.ok(screen.getByText('Custom Error: Custom throw'));
    assert.ok(screen.getByRole('button', { name: 'Try Again' }));
  });
});
