import AsyncStorage from '@react-native-async-storage/async-storage';

// When to offer the permission primer (Decision 7): after a customer's first sent request, after
// an owner finishes onboarding, on an owner's first look at Received, and never at launch. A
// trigger only *asks* (requestPrimer); usePrimerOpener, mounted once at the root, decides and
// opens it once the screen has settled. Shown at most once per person on this phone (a stored
// flag, written whenever the primer opens, so Not now and a swipe-away both count) and at most
// once per app run.

export type PrimerRole = 'customer' | 'owner';

export const PRIMER_KEY_PREFIX = 'liketoorder.notifications.primer.v1.';

/** How long the route must stay unchanged before the primer opens over it. */
export const PRIMER_SETTLE_MS = 1000;

let pending: PrimerRole | null = null;
const listeners = new Set<() => void>();
const openedThisRun = new Set<string>();

function notify() {
  listeners.forEach((listener) => listener());
}

/** A trigger: the primer may open once the screen settles, if the person is eligible. */
export function requestPrimer(role: PrimerRole): void {
  if (pending === role) return;
  pending = role;
  notify();
}

export function getPendingPrimer(): PrimerRole | null {
  return pending;
}

export function clearPendingPrimer(): void {
  if (pending === null) return;
  pending = null;
  notify();
}

export function subscribePrimer(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function hasOpenedThisRun(userId: string): boolean {
  return openedThisRun.has(userId);
}

export function markOpenedThisRun(userId: string): void {
  openedThisRun.add(userId);
}

/** Whether this person has already been shown the primer on this phone. Unreadable counts as yes. */
export async function readPrimerSeen(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(`${PRIMER_KEY_PREFIX}${userId}`)) === '1';
  } catch {
    // Storage is broken: never nag.
    return true;
  }
}

export async function savePrimerSeen(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(`${PRIMER_KEY_PREFIX}${userId}`, '1');
  } catch {
    // Ignore: the once-per-run rule still holds; at worst it is offered again next launch.
  }
}

/** Test-only: forget the pending request and the once-per-run memory. */
export function resetPrimerMomentForTests(): void {
  pending = null;
  openedThisRun.clear();
}
