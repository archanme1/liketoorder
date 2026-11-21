import { useMutation, useQueryClient } from '@tanstack/react-query';

import { cancelMyPromotion, type PromotionAppError } from '../api';
import type { MyPromotion } from '../schema';

import { refreshAfterRefusal, showAnswer } from './promotionCache';

/** Takes the promotion id. */
export function useCancelPromotion() {
  const queryClient = useQueryClient();

  return useMutation<MyPromotion, PromotionAppError, string>({
    mutationFn: cancelMyPromotion,
    onSuccess: (answer) => showAnswer(queryClient, answer),
    onError: (error) => refreshAfterRefusal(queryClient, error),
  });
}
