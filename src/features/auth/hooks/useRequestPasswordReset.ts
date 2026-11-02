import { useMutation } from '@tanstack/react-query';

import { requestPasswordReset, type AuthAppError } from '../api';

export function useRequestPasswordReset() {
  return useMutation<void, AuthAppError, { email: string }>({
    mutationFn: ({ email }) => requestPasswordReset(email),
  });
}
