import type { RequestErrorCode } from './api';
import type { RequestKind } from './kind';
import type { InboxFilter, RequestStatus } from './schema';

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
/** On a table request the customer has tapped "I've arrived". */
export const CUSTOMER_ARRIVED = 'Customer has arrived';
export const NOT_FOUND_MESSAGE = "We couldn't find that request.";
export const NO_UNDO = "You can't undo this.";
export const DECLINE_REASON_TITLE = 'Why are you declining?';
export const DECLINE_REASON_REQUIRED = 'Choose a reason first';
export const OTHER_REASON_LABEL = 'Your reason';
export const OTHER_REASON_REQUIRED = 'Write your reason first';
export const ACCEPT_NOTE_LABEL = 'Note for the customer (optional)';
export const ACCEPT_ADDRESS_HINT =
  "Your address is shared automatically after you accept, so don't type it here";

/** The live counter under a note box, in words: "12 of 200". */
export function counterText(length: number, max: number): string {
  return `${length} of ${max}`;
}

export type SellerAction = 'accepted' | 'declined' | 'completed' | 'no_show';

/** The short confirm step for a final action. Only a homemade Accept mentions the exact address. */
export function confirmCopy(
  action: SellerAction,
  homemade: boolean,
  kind: RequestKind = 'pickup',
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
        body:
          kind === 'table'
            ? `Use this once the customer has had their table. ${NO_UNDO}`
            : `Use this once the customer has picked up the order. ${NO_UNDO}`,
      };
    case 'no_show':
      return {
        title: 'Mark as no-show?',
        body:
          kind === 'table'
            ? `Use this if the customer did not come for their table. ${NO_UNDO}`
            : `Use this if the customer did not pick up the order. ${NO_UNDO}`,
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
export function sellerStatusSentence(status: RequestStatus, kind: RequestKind = 'pickup'): string {
  if (kind === 'table' && status === 'completed') return 'Table visit completed';
  if (kind === 'table' && status === 'no_show') return 'Marked as not arrived';
  return STATUS_SENTENCE[status];
}

/** The customer's display name (or username); a request whose profile is gone says "Customer". */
export function customerLabel(name: string | null): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : 'Customer';
}

export function emptyMessage(filter: InboxFilter): string {
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
      return NOT_FOUND_MESSAGE;
    case 'not_signed_in':
      return 'Sign in again to answer requests.';
    case 'decline_reason_required':
      return 'Choose a reason before declining.';
    case 'invalid_text':
      return "Your note has characters we can't send. Edit it and try again.";
    default:
      return 'Something went wrong. Try again.';
  }
}
