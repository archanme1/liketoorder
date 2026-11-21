import type { QueryClient } from '@tanstack/react-query';

import type { PromotionAppError, PromotionErrorCode } from '../api';
import type { MyPromotion } from '../schema';

import { myPromotionKey } from './useMyPromotion';

// Refusals that mean the screen's copy is out of date: something changed on the server (another
// device, the admin, the clock, the settings or the listing).
const STALE_CODES: readonly PromotionErrorCode[] = [
  'already_open',
  'not_eligible',
  'not_configured',
  'not_found',
  'not_cancellable',
];

/** Request and cancel answer with the full get_my_promotion object: show it at once, then re-read. */
export function showAnswer(queryClient: QueryClient, answer: MyPromotion): void {
  queryClient.setQueryData(myPromotionKey, answer);
  void queryClient.invalidateQueries({ queryKey: myPromotionKey });
}

export function refreshAfterRefusal(queryClient: QueryClient, error: PromotionAppError): void {
  if (STALE_CODES.includes(error.code)) {
    void queryClient.invalidateQueries({ queryKey: myPromotionKey });
  }
}
