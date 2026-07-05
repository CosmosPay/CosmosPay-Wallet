import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { WalletStore } from '@/components/store';
import { Spinner } from '@/components/parts';
import '@/styles/screens/fiat/fiat.css';

/** A single KYC photo step: pick from camera/gallery, upload, show progress + result.
 *  The green "done" border comes from the `.is-done` modifier class. */
export function PhotoStep({ store, capture, title, hint, fileUrl, onUploaded }: { store: WalletStore; capture: 'environment' | 'user'; title: string; hint: string; fileUrl: string | null; onUploaded: (url: string) => void }) {
  const [preview, setPreview] = useState('');
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    const url = await store.uploadKycDoc(file, 'onboarding');
    setUploading(false);
    if (url) onUploaded(url);
  };

  const done = !!fileUrl && !uploading;
  const shape = capture === 'user' ? 'fiat-photo-drop-selfie' : 'fiat-photo-drop-doc';
  return (
    <>
      <div className="fiat-photo-title">{title}</div>
      <div className="fiat-desc fiat-kyc-desc">{hint}</div>
      <div onClick={() => inputRef.current?.click()} className={`tap center fiat-photo-drop ${shape}${done ? ' is-done' : ''}`}>
        {preview ? (
          <img src={preview} alt="" className="fiat-photo-img" />
        ) : (
          <div className="col g10 fiat-photo-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.5h5l1 1.5H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" stroke="currentColor" strokeWidth="1.7" /><circle cx="12" cy="12.5" r="3.2" stroke="currentColor" strokeWidth="1.7" /></svg>
            <span className="fiat-photo-cta">{store.t('fiat.takePhoto')}</span>
          </div>
        )}
        {uploading && (
          <div className="center fiat-photo-loading"><Spinner color="#fff" /></div>
        )}
        {done && (
          <div className="center fiat-photo-done">✓</div>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" capture={capture} onChange={pick} className="fiat-photo-file" />
    </>
  );
}
