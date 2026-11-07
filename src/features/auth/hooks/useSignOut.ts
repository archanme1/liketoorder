import { useMutation } from '@tanstack/react-query';

import { signOut, type AuthAppError } from '../api';
import { clearReturnTo } from '../returnTo';

import { useSession } from './useSession';

// The SIGNED_OUT event clears the recovery flag and the react-query cache in AuthProvider.
// `onSuccess` is a hook-level option so it still runs when sign-out unmounts the caller.
export function useSignOut({ onSuccess }: { onSuccess?: () => void } = {}) {
  const { clearRecovering } = useSession();

  return useMutation<void, AuthAppError, void>({
    mutationFn: async () => {
      await signOut();
      clearReturnTo();
      await clearRecovering();
    },
    onSuccess,
  });
}
