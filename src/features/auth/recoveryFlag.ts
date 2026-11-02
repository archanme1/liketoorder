import AsyncStorage from '@react-native-async-storage/async-storage';

// Persists "mid password reset" across relaunches so a recovery session never counts as signed in.
const RECOVERY_KEY = 'liketoorder.auth.isRecovering';

export async function readRecoveryFlag(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(RECOVERY_KEY)) === 'true';
  } catch {
    return false;
  }
}

export async function writeRecoveryFlag(value: boolean): Promise<void> {
  try {
    if (value) {
      await AsyncStorage.setItem(RECOVERY_KEY, 'true');
    } else {
      await AsyncStorage.removeItem(RECOVERY_KEY);
    }
  } catch {
    // Storage failure only affects the relaunch case; the in-memory flag still guards routes.
  }
}
