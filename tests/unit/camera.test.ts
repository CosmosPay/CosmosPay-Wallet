/**
 * The scanner used to render one message — "check permissions" — for every way a camera can
 * fail to open, including the three that no permission would have fixed. These are the cases
 * that message was wrong about.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraApiAvailable, cameraFailure, cameraFailureKey, type CameraFailure } from '@/lib/camera';
import { T } from '@/lib/i18n';

/** What getUserMedia actually rejects with: a DOMException carrying a name. */
const domError = (name: string) => Object.assign(new Error('irrelevant prose'), { name });

test('a refused permission is the only "denied"', () => {
  assert.equal(cameraFailure(domError('NotAllowedError')), 'denied');
  assert.equal(cameraFailure(domError('PermissionDeniedError')), 'denied'); // legacy WebViews
  assert.equal(cameraFailure(domError('SecurityError')), 'denied');
});

test('no camera, or a device id that no longer resolves, is not a permission problem', () => {
  assert.equal(cameraFailure(domError('NotFoundError')), 'notFound');
  assert.equal(cameraFailure(domError('DevicesNotFoundError')), 'notFound');
  assert.equal(cameraFailure(domError('OverconstrainedError')), 'notFound');
});

test('a camera another app is holding is not a permission problem either', () => {
  assert.equal(cameraFailure(domError('NotReadableError')), 'inUse');
  assert.equal(cameraFailure(domError('TrackStartError')), 'inUse');
  assert.equal(cameraFailure(domError('AbortError')), 'inUse');
});

test('an insecure origin has no mediaDevices at all, which is a TypeError', () => {
  // `navigator.mediaDevices.getUserMedia(...)` on an http:// LAN address — the one mode
  // `npm run dev:android -- --live --lan` puts the WebView in.
  assert.equal(cameraFailure(new TypeError('Cannot read properties of undefined')), 'unsupported');
});

test('anything unrecognised classifies, it does not throw', () => {
  assert.equal(cameraFailure(domError('SomeFutureError')), 'unknown');
  assert.equal(cameraFailure(new Error('bare')), 'unknown');
  assert.equal(cameraFailure(null), 'unknown');
  assert.equal(cameraFailure(undefined), 'unknown');
  assert.equal(cameraFailure('a string'), 'unknown');
});

test('every failure has a message, in every language', () => {
  const failures: CameraFailure[] = ['unsupported', 'denied', 'notFound', 'inUse', 'unknown'];
  for (const failure of failures) {
    const key = cameraFailureKey(failure);
    // i18n.test.ts proves the five columns are complete; this proves the key is one of them,
    // since `t()` renders an unknown key as itself and that would ship "scan.busy" on screen.
    assert.ok(Object.hasOwn(T, key), `${failure} -> ${key} is not an i18n key`);
  }
});

test('the availability check answers without a navigator', () => {
  // node:test has no DOM. The scanner asks this before it touches the API, so it has to be
  // total rather than throw the very error it exists to avoid.
  assert.equal(cameraApiAvailable(), false);
});
