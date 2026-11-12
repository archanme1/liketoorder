import AsyncStorage from '@react-native-async-storage/async-storage';

import { unregisterPushToken } from './api';
import { PUSH_TOKEN_PATTERN } from './schema';

// Phone-only storage: the last push token this phone registered, so sign-out knows which one to
// remove. It never leaves the phone except in unregister_push_token. Every call is wrapped:
// storage can be missing or full, and must never block sign-in or sign-out.
export const TOKEN_KEY = 'liketoorder.push.token.v1';

/** How long sign-out waits for the token to be removed before it signs out anyway. */
export const UNREGISTER_TIMEOUT_MS = 3000;

export async function readStoredToken(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(TOKEN_KEY);
    return raw !== null && PUSH_TOKEN_PATTERN.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

export async function saveStoredToken(token: string): Promise<void> {
  try {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Ignore: sign-out then has nothing to remove, and the next sign-in moves the token anyway.
  }
}

export async function clearStoredToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore: unregistering the same token again is harmless.
  }
}

/**
 * Best effort, before sign-out: removes this phone's token from the signed-in user, so they stop
 * getting pushes here. Resolves after at most `timeoutMs` and never throws. If it fails, the stored
 * token is kept: the next sign-in on this phone moves the token, and the tap resolver protects a
 * wrong account (Decision 11).
 */
export async function unregisterThisPhone(
  timeoutMs: number = UNREGISTER_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => {
    const token = await readStoredToken();
    if (!token) return;
    await unregisterPushToken(token);
    await clearStoredToken();
  })().catch(() => undefined);
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
