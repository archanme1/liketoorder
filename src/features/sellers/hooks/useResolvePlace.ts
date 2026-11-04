import { useMutation, useQueryClient } from '@tanstack/react-query';

import { resolvePlace, type SellerAppError } from '../api';
import type { MyBusiness } from '../schema';

import { myBusinessKey } from './useMyBusiness';

type ResolveInput = { placeId: string; sessionToken: string };

export function useResolvePlace() {
  const queryClient = useQueryClient();

  return useMutation<MyBusiness, SellerAppError, ResolveInput>({
    mutationFn: ({ placeId, sessionToken }) => resolvePlace(placeId, sessionToken),
    // Drop the finished mutation (and its place ID) from the cache as soon as nothing observes it.
    gcTime: 0,
    onSuccess: (business) => {
      queryClient.setQueryData(myBusinessKey, business);
    },
  });
}
