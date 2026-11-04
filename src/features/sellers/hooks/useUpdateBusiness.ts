import { useMutation, useQueryClient } from '@tanstack/react-query';

import { myProfileKey } from '@/features/profile/hooks/useMyProfile';

import { updateMyBusiness, type BusinessPatch, type SellerAppError } from '../api';
import type { MyBusiness } from '../schema';

import { myBusinessKey } from './useMyBusiness';

export function useUpdateBusiness(id: string) {
  const queryClient = useQueryClient();

  return useMutation<MyBusiness, SellerAppError, BusinessPatch>({
    mutationFn: (patch) => updateMyBusiness(id, patch),
    onSuccess: (business) => {
      // Write the saved view straight into the cache so Manage Business updates at once.
      queryClient.setQueryData(myBusinessKey, business);
      void queryClient.invalidateQueries({ queryKey: myBusinessKey });
      void queryClient.invalidateQueries({ queryKey: myProfileKey });
    },
  });
}
