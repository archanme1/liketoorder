import { useMutation } from '@tanstack/react-query';

import { verifyEmailCode, type AuthAppError } from '../api';

export function useVerifyEmailCode() {
  return useMutation<void, AuthAppError, { email: string; code: string }>({
    mutationFn: ({ email, code }) => verifyEmailCode(email, code),
  });
}
