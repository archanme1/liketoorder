import { focusManager } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';

// React Native has no window focus, so react-query never refetches stale data when the app comes
// back to the foreground unless AppState is wired to its focusManager (the TanStack RN pattern).
// Needed so stale signed URLs (spec 06 Decision 15) renew after the phone has been asleep.
export function onAppStateChange(status: AppStateStatus): void {
  if (Platform.OS !== 'web') focusManager.setFocused(status === 'active');
}

export function useAppFocus(): void {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', onAppStateChange);
    return () => subscription.remove();
  }, []);
}
