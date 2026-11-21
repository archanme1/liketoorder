import { useMutation, useQueryClient } from '@tanstack/react-query';

import { requestPromotion, type PromotionAppError, type PromotionRequest } from '../api';
import type { MyPromotion } from '../schema';

import { refreshAfterRefusal, showAnswer } from './promotionCache';

export function useRequestPromotion() {
  const queryClient = useQueryClient();

  return useMutation<MyPromotion, PromotionAppError, PromotionRequest>({
    mutationFn: requestPromotion,
    onSuccess: (answer) => showAnswer(queryClient, answer),
    onError: (error) => refreshAfterRefusal(queryClient, error),
  });
}
