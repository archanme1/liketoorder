import AsyncStorage from '@react-native-async-storage/async-storage';

// Spec 12 replaced the phone's "seen" memory of 10b (statusMemory) with a server-side flag. The
// old memory (one key per user who ever signed in on this phone) is removed once per app run,
// best effort: a failure only leaves unused keys behind.
export const LEGACY_PREFIX = 'liketoorder.requests.seen.v1.';

let removed = false;

export async function removeLegacyStatusMemory(): Promise<void> {
  if (removed) return;
  removed = true;
  try {
    const keys = await AsyncStorage.getAllKeys();
    const old = keys.filter((key) => key.startsWith(LEGACY_PREFIX));
    if (old.length > 0) await AsyncStorage.multiRemove(old);
  } catch {
    // Ignore: nothing reads these keys any more.
  }
}

/** Test-only: allow the removal to run again. */
export function resetLegacyStatusMemoryForTests(): void {
  removed = false;
}
