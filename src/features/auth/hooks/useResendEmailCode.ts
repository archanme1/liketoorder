import { useMutation } from '@tanstack/react-query';

import { resendEmailCode, type AuthAppError } from '../api';

export function useResendEmailCode() {
  return useMutation<void, AuthAppError, { email: string }>({
    mutationFn: ({ email }) => resendEmailCode(email),
  });
}
