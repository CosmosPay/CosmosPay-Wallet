/**
 * Where the Android SDK is, and how to reach adb inside it.
 *
 * Used by scripts/adb-pair.ts. Android Studio installs the SDK
 * but exports no environment variable on Windows or macOS, so Gradle, native-run and adb
 * all have to be told where it lives — and two scripts guessing separately is how one of
 * them ends up pairing a phone into an SDK the other never builds against.
 */
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The SDK root: whatever the environment says, else the per-OS default install path. */
export function androidSdkDir(): string | undefined {
  const fromEnv = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (fromEnv) return fromEnv;
  const home = homedir();
  const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
  return {
    win32: join(local, 'Android', 'Sdk'),
    darwin: join(home, 'Library', 'Android', 'sdk'),
    linux: join(home, 'Android', 'Sdk'),
  }[process.platform as 'win32' | 'darwin' | 'linux'];
}

/** The adb executable, or undefined when platform-tools is not installed. */
export async function adbPath(): Promise<string | undefined> {
  const sdk = androidSdkDir();
  if (!sdk) return undefined;
  const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  try {
    await access(adb);
    return adb;
  } catch {
    return undefined;
  }
}
