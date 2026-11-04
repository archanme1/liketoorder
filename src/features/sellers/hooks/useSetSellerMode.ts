import { useMutation, useQueryClient } from '@tanstack/react-query';

import { myProfileKey } from '@/features/profile/hooks/useMyProfile';

import { setSellerMode, type SellerAppError } from '../api';

import { myBusinessKey } from './useMyBusiness';

export function useSetSellerMode() {
  const queryClient = useQueryClient();

  return useMutation<void, SellerAppError, boolean>({
    mutationFn: (on) => setSellerMode(on),
    onSuccess: async () => {
      // The profile refetch updates is_seller, which shows or hides the Manage tab.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: myBusinessKey }),
        queryClient.invalidateQueries({ queryKey: myProfileKey }),
      ]);
    },
  });
}
