import { useMutation } from '@tanstack/react-query';

import { UNREGISTER_TIMEOUT_MS, unregisterThisPhone } from '@/features/notifications/tokenStore';

import { signOut, type AuthAppError } from '../api';
import { clearReturnTo } from '../returnTo';

import { useSession } from './useSession';

// The SIGNED_OUT event clears the recovery flag and the react-query cache in AuthProvider.
// `onSuccess` is a hook-level option so it still runs when sign-out unmounts the caller.
// This phone's push token is removed first, while the session can still authorize it; that step
// is best effort, waits at most `unregisterTimeoutMs` and never stops the sign-out (spec 12).
export function useSignOut({
  onSuccess,
  unregisterTimeoutMs = UNREGISTER_TIMEOUT_MS,
}: { onSuccess?: () => void; unregisterTimeoutMs?: number } = {}) {
  const { clearRecovering } = useSession();

  return useMutation<void, AuthAppError, void>({
    mutationFn: async () => {
      await unregisterThisPhone(unregisterTimeoutMs);
      await signOut();
      clearReturnTo();
      await clearRecovering();
    },
    onSuccess,
  });
}
