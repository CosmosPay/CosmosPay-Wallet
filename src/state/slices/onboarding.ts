import { useState } from 'react';
import type { VerifyTarget, Gender } from '@/state/store';
import type { DerivedAccount } from '@/lib/vault';

export function useOnboardingSlice() {
  const [draftMnemonic, setDraftMnemonic] = useState<string>('');
  const [draftAccount, setDraftAccount] = useState<DerivedAccount | null>(null);
  const [draftHasMnemonic, setDraftHasMnemonic] = useState(true);
  const [importText, setImportText] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftBirthdate, setDraftBirthdate] = useState('');
  const [draftEmail, setDraftEmail] = useState('');
  const [draftGender, setDraftGender] = useState<Gender | ''>('');
  const [draftMetricsOptIn, setDraftMetricsOptIn] = useState(false);
  const [draftPromoOptIn, setDraftPromoOptIn] = useState(false);
  const [verifyTargets, setVerifyTargets] = useState<VerifyTarget[]>([]);
  const [verifyFilled, setVerifyFilled] = useState<Record<number, string>>({});
  const [verifyBank, setVerifyBank] = useState<string[]>([]);

  return {
    draftMnemonic, setDraftMnemonic,
    draftAccount, setDraftAccount,
    draftHasMnemonic, setDraftHasMnemonic,
    importText, setImportText,
    draftName, setDraftName,
    draftBirthdate, setDraftBirthdate,
    draftEmail, setDraftEmail,
    draftGender, setDraftGender,
    draftMetricsOptIn, setDraftMetricsOptIn,
    draftPromoOptIn, setDraftPromoOptIn,
    verifyTargets, setVerifyTargets,
    verifyFilled, setVerifyFilled,
    verifyBank, setVerifyBank,
  };
}
