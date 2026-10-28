import type { ReactNode } from 'react';
import { ScreenHeader } from '@/ui/ScreenHeader';

/**
 * The old header's API, drawn as the redesign's: the way back on the shell's bar at the top
 * left (`ui/ScreenBar`), the title as the screen's `h1`, `right` beside it. Kept so every
 * screen not yet rewritten wears the new header today; new screens use `ScreenHeader`.
 */
export function BackBar({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode }) {
  return <ScreenHeader title={title} onBack={onBack} right={right} />;
}
