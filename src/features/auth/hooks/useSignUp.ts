import { useMutation } from '@tanstack/react-query';

import { signUp, type AuthAppError } from '../api';

export function useSignUp() {
  return useMutation<void, AuthAppError, { email: string; password: string }>({
    mutationFn: ({ email, password }) => signUp(email, password),
  });
}
