import { useMutation } from '@tanstack/react-query';

import { verifyResetCode, type AuthAppError } from '../api';

import { useSession } from './useSession';

export function useVerifyResetCode() {
  const { prepareRecovery, abandonRecovery, markRecovering } = useSession();

  return useMutation<void, AuthAppError, { email: string; code: string }>({
    mutationFn: async ({ email, code }) => {
      await prepareRecovery();
      try {
        await verifyResetCode(email, code);
      } catch (error) {
        await abandonRecovery();
        throw error;
      }
      // PASSWORD_RECOVERY usually sets this already; set it directly too, as the spec requires.
      await markRecovering();
    },
  });
}
