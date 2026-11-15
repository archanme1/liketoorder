import { useRouter } from 'expo-router';
import { useCallback } from 'react';

/** Back to the previous screen, or to the list when the screen was opened by a deep link. */
export function useFoodLogBack() {
  const router = useRouter();
  return useCallback(
    () => (router.canGoBack() ? router.back() : router.replace('/food-log')),
    [router],
  );
}
