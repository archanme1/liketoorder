import type { RequestErrorCode } from './api';
import type { RequestStatus } from './schema';

// The seller's wording (messages.ts and statusSentence are written for the customer). A pending
// request never reads as booked, confirmed or accepted; "accepted" appears only once the seller
// has accepted it.

export const EMPTY_INBOX = 'No requests yet. Customers who request pickup will show up here.';
export const EMPTY_WAITING = 'Nothing waiting for you right now.';
export const INBOX_LOAD_MORE_ERROR = "Couldn't load more requests.";
export const INBOX_REFRESH_ERROR = "Couldn't refresh your requests.";
export const NO_PRICE_NOTE = 'Total excludes items without a price';
export const CUSTOMER_PAYS_NOTE = 'Estimated total. The customer pays you directly.';
export const ACCEPT_ADDRESS_NOTICE =
  'Your exact address will be shown to the customer until 24 hours after the pickup time.';
export const NO_UNDO = "You can't undo this.";

export type SellerAction = 'accepted' | 'declined' | 'completed' | 'no_show';

/** The short confirm step for a final action. Only a homemade Accept mentions the exact address. */
export function confirmCopy(
  action: SellerAction,
  homemade: boolean,
): { title: string; body: string } {
  switch (action) {
    case 'accepted':
      return {
        title: 'Accept this request?',
        body: homemade
          ? `${ACCEPT_ADDRESS_NOTICE} ${NO_UNDO}`
          : `The customer will see that you accepted it. ${NO_UNDO}`,
      };
    case 'declined':
      return {
        title: 'Decline this request?',
        body: `The customer will see that you declined it. ${NO_UNDO}`,
      };
    case 'completed':
      return {
        title: 'Mark as completed?',
        body: `Use this once the customer has picked up the order. ${NO_UNDO}`,
      };
    case 'no_show':
      return {
        title: 'Mark as no-show?',
        body: `Use this if the customer did not pick up the order. ${NO_UNDO}`,
      };
  }
}

const STATUS_SENTENCE: Record<RequestStatus, string> = {
  pending: 'Waiting for your answer',
  accepted: 'You accepted this request',
  declined: 'You declined this request',
  expired: 'This request expired before you answered',
  cancelled: 'The customer cancelled this request',
  completed: 'Pickup completed',
  no_show: 'Marked as not picked up',
};

/** The sentence under a status for the seller. */
export function sellerStatusSentence(status: RequestStatus): string {
  return STATUS_SENTENCE[status];
}

/** The customer's display name (or username); a request whose profile is gone says "Customer". */
export function customerLabel(name: string | null): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : 'Customer';
}

export function emptyMessage(filter: 'waiting' | 'all'): string {
  return filter === 'waiting' ? EMPTY_WAITING : EMPTY_INBOX;
}

/** What a failed load of the inbox, the detail or the count says. */
export function inboxErrorMessage(code: RequestErrorCode): string {
  return code === 'network'
    ? 'No connection. Check your internet and try again.'
    : "We couldn't load your requests. Try again.";
}

/** What a failed Accept / Decline / Completed / No-show says. */
export function actionErrorMessage(code: RequestErrorCode): string {
  switch (code) {
    case 'network':
      return 'No connection. Nothing was changed. Try again.';
    case 'invalid_transition':
      return 'This request has changed (it may have expired, been cancelled or already been answered). Its current status is shown.';
    case 'not_found':
      return "We couldn't find that request.";
    case 'not_signed_in':
      return 'Sign in again to answer requests.';
    default:
      return 'Something went wrong. Try again.';
  }
}
