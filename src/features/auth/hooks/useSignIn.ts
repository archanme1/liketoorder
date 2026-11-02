import { useMutation } from '@tanstack/react-query';

import { signIn, type AuthAppError } from '../api';

export function useSignIn() {
  return useMutation<void, AuthAppError, { email: string; password: string }>({
    mutationFn: ({ email, password }) => signIn(email, password),
  });
}
