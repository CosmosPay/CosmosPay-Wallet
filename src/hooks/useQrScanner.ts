import { useEffect, useRef, useState, type RefObject } from 'react';
import jsQR from 'jsqr';
import { cameraFailure, openCameraStream, type CameraFailure } from '@/lib/camera';

/**
 * Read QR codes from the camera into `onText` until it returns true (the code was the one
 * the screen wanted) or the screen stops asking (`active` false, or unmount).
 *
 * The loop of src/features/extras/ScanQR.tsx without its screen: that one belongs to the
 * payment flow (SEP-7, image upload, device picker). Here only the stream, the frame loop
 * and the failure classification, so a screen with its own copy and layout can scan.
 */
export function useQrScanner(
  videoRef: RefObject<HTMLVideoElement | null>,
  onText: (text: string) => boolean,
  active: boolean,
): { failure: CameraFailure | null; retry: () => void } {
  const [failure, setFailure] = useState<CameraFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    setFailure(null);

    const cleanup = () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
    };

    const tick = () => {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);
          const res = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
          if (res?.data && onTextRef.current(res.data)) {
            cleanup();
            return;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        stream = await openCameraStream();
        if (stopped) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
          raf = requestAnimationFrame(tick);
        }
      } catch (err) {
        if (!stopped) setFailure(cameraFailure(err));
      }
    })();

    return cleanup;
  }, [active, attempt, videoRef]);

  return { failure, retry: () => setAttempt((n) => n + 1) };
}
