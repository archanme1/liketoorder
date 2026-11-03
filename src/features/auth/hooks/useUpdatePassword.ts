import { useMutation } from '@tanstack/react-query';

import { updatePassword, type AuthAppError } from '../api';

import { useSession } from './useSession';

// `onSuccess` is a hook-level option so it still runs after clearing isRecovering unmounts the caller.
export function useUpdatePassword({ onSuccess }: { onSuccess?: () => void } = {}) {
  const { clearRecovering } = useSession();

  return useMutation<void, AuthAppError, { password: string }>({
    mutationFn: async ({ password }) => {
      await updatePassword(password);
      // Only now is the user treated as signed in.
      await clearRecovering('password-updated');
    },
    onSuccess,
  });
}
