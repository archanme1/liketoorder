import { declineReasonLabel } from './declineReasons';
import { declinedLine, sellerNoteLine } from './messages';
import type { PickupRequest } from './schema';

type Answer = Pick<PickupRequest, 'status' | 'decline_reason' | 'response_note'>;

/**
 * What the seller said about a request, as plain words for both sides of the list and the detail:
 * "Declined: Sold out" (for Other, the seller's own words) on a declined request, and
 * "Seller's note: ..." on an accepted, completed or no-show one. A request that is still pending,
 * expired or cancelled has no answer and so no lines, and a request declined before spec 10b has
 * no reason (its status chip already says Declined).
 */
export function answerLines(request: Answer): string[] {
  if (request.status === 'declined') {
    const reason = declineReasonLabel(request.decline_reason, request.response_note);
    return reason ? [declinedLine(reason)] : [];
  }
  if (
    (request.status === 'accepted' ||
      request.status === 'completed' ||
      request.status === 'no_show') &&
    request.response_note
  ) {
    return [sellerNoteLine(request.response_note)];
  }
  return [];
}
