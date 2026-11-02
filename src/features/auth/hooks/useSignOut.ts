import { useMutation } from '@tanstack/react-query';

import { signOut, type AuthAppError } from '../api';

import { useSession } from './useSession';

// The SIGNED_OUT event clears the recovery flag and the react-query cache in AuthProvider.
export function useSignOut() {
  const { clearRecovering } = useSession();

  return useMutation<void, AuthAppError, void>({
    mutationFn: async () => {
      await signOut();
      await clearRecovering();
    },
  });
}
