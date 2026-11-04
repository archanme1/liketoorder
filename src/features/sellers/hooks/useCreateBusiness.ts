import { useMutation, useQueryClient } from '@tanstack/react-query';

import { myProfileKey } from '@/features/profile/hooks/useMyProfile';

import { createMyBusiness, type CreateBusinessInput, type SellerAppError } from '../api';

import { myBusinessKey } from './useMyBusiness';

export function useCreateBusiness() {
  const queryClient = useQueryClient();

  return useMutation<string, SellerAppError, CreateBusinessInput>({
    mutationFn: (input) => createMyBusiness(input),
    onSuccess: async () => {
      // is_seller flips on with the business, so the Manage tab appears without a restart.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: myBusinessKey }),
        queryClient.invalidateQueries({ queryKey: myProfileKey }),
      ]);
    },
  });
}
