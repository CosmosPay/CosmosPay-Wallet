/**
 * Opening the camera, and saying why it did not open.
 *
 * Lives here rather than in `src/features/extras/ScanQR.tsx` for the reason the amount and
 * memo rules do: the screen used to catch every failure into one string — "check permissions" —
 * so a phone with no camera, a WebView served over plain http, and a camera held by another app
 * all told the user to go change a setting that was never the problem. The mapping is a pure
 * function of the error, so it is a unit test (tests/unit/camera.test.ts) instead of a manual
 * check nobody can perform on five devices.
 */

/** Why the camera could not be opened — one reason per user-facing message. */
export type CameraFailure = 'unsupported' | 'denied' | 'notFound' | 'inUse' | 'unknown';

/**
 * Is there a camera API to call at all?
 *
 * `navigator.mediaDevices` is undefined — not merely unhelpful — outside a secure context, and
 * the app runs in four of them. The native build serves from `https://localhost` and the
 * extension from `chrome-extension://`, both secure; `npm run dev:android -- --live --lan`
 * serves from `http://<LAN-IP>:4500`, which is not, so the scanner cannot work in that one mode
 * and should say so rather than blame a permission.
 */
export function cameraApiAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

/**
 * Classify a `getUserMedia` rejection.
 *
 * Matches on `name`, never on `message`: the message is the browser's own prose, it is
 * localized on some platforms, and it is the field vendors rewrite between versions. The
 * legacy aliases are still what older Android WebViews throw.
 */
export function cameraFailure(err: unknown): CameraFailure {
  const name = (err as { name?: unknown } | null)?.name;
  switch (typeof name === 'string' ? name : '') {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'notFound';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'inUse';
    // Reading `.getUserMedia` off an undefined `mediaDevices` throws a plain TypeError, which
    // is the insecure-origin case above rather than anything the user did.
    case 'TypeError':
      return 'unsupported';
    default:
      return 'unknown';
  }
}

/** The i18n key that explains a failure. Kept beside the union so adding a case breaks here. */
export function cameraFailureKey(failure: CameraFailure): string {
  const KEYS: Record<CameraFailure, string> = {
    unsupported: 'scan.noCam',
    denied: 'scan.denied',
    notFound: 'scan.noDevice',
    inUse: 'scan.busy',
    unknown: 'scan.failed',
  };
  return KEYS[failure];
}

/**
 * Open a video stream, preferring the back camera.
 *
 * `facingMode: 'environment'` is a *preference* — a browser that has only a front camera
 * honours it by handing that one over. `deviceId: { exact }` is not, and a device that was
 * unplugged (or a stale id remembered across a session) rejects with OverconstrainedError; one
 * retry on the default constraints is the difference between the scanner recovering and the
 * user staring at "no camera found" with a camera in their hand.
 */
export async function openCameraStream(deviceId?: string): Promise<MediaStream> {
  if (!cameraApiAvailable()) throw new TypeError('mediaDevices unavailable');
  if (!deviceId) return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } });
  } catch (err) {
    if (cameraFailure(err) !== 'notFound') throw err;
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  }
}
