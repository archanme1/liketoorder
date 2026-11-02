import { useMutation } from '@tanstack/react-query';

import { AuthAppError, verifyResetCode } from '../api';

import { useSession } from './useSession';

export function useVerifyResetCode() {
  const { prepareRecovery, abandonRecovery, markRecovering } = useSession();

  return useMutation<void, AuthAppError, { email: string; code: string }>({
    mutationFn: async ({ email, code }) => {
      try {
        await prepareRecovery();
      } catch {
        // Without the stored flag, a relaunch mid-reset would count as signed in. Don't verify.
        throw new AuthAppError('unknown');
      }
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
