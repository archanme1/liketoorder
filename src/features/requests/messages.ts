import type { RequestErrorCode } from './api';

export const PAY_NOTE = 'Estimated total. Pay the seller directly.';
export const NO_PRICE_NOTE = 'Total excludes items without a price';
export const NO_MENU_NOTE = "No menu items available. Describe what you'd like.";
export const EMPTY_LIST = 'No requests yet. Find a place on the map and request pickup.';
export const TABLE_SENT_NOTE =
  'The restaurant will answer this request. Until it does, nothing is reserved.';
export const ARRIVED_DONE = "You've told the restaurant you arrived";
export const SENT_EMPTY = 'No requests yet. Requests you send will show up here.';
export const BUSINESS_CHECK_ERROR = "Couldn't check your business, so Received is not shown.";
export const NOT_AVAILABLE = "This place isn't available right now.";

export function sentMessage(sellerName: string): string {
  return `Waiting for ${sellerName} to respond.`;
}

/** After a table request is sent. Pending is never worded as booked or confirmed. */
export function tableSentMessage(sellerName: string): string {
  return `Table request waiting for ${sellerName}.`;
}

/** What the person is told for each failure. Never says why a business is unavailable. */
export function requestErrorMessage(code: RequestErrorCode): string {
  switch (code) {
    case 'network':
      return 'No connection. Check your internet and try again. Your request was not lost.';
    case 'not_signed_in':
    case 'profile_incomplete':
      return 'Sign in and finish your profile to send a request.';
    case 'business_unavailable':
      return NOT_AVAILABLE;
    case 'own_business':
      return "You can't request from your own business.";
    case 'invalid_pickup_time':
      return 'Pick a later time';
    case 'invalid_table_time':
      return 'Pick a table time between 30 minutes and 30 days from now.';
    case 'invalid_party_size':
      return 'Choose a party of 1 to 20 people.';
    case 'already_arrived':
      return "You've already told the restaurant you arrived.";
    case 'arrival_window':
      return "You can tell the restaurant you've arrived from 2 hours before the table time until 4 hours after it.";
    case 'invalid_items':
      return 'Something is wrong with your items. Check the quantities and try again.';
    case 'item_unavailable':
      return 'An item you chose is no longer available. Remove it or describe it instead.';
    case 'invalid_text':
      return "Your order or note has characters we can't send. Edit it and try again.";
    case 'empty_order':
      return "Choose an item or describe what you'd like.";
    case 'too_many_pending':
      return 'You have too many requests waiting. You can have up to 3 pickup and 3 table requests waiting, and 1 per place. Cancel one or wait for an answer.';
    case 'rate_limited':
      return "You've sent a lot of requests to this place today. Please try again tomorrow.";
    case 'invalid_transition':
      return "This request can't be cancelled any more.";
    case 'not_found':
      return "We couldn't find that request.";
    default:
      return 'Something went wrong. Try again.';
  }
}

export function loadErrorMessage(code: RequestErrorCode): string {
  return code === 'network'
    ? 'No connection. Check your internet and try again.'
    : "We couldn't load your requests. Try again.";
}

/** The seller's answer on a customer's request. Plain text only: no links, no markup. */
export function declinedLine(reason: string | null): string {
  return reason ? `Declined: ${reason}` : 'Declined';
}

export function sellerNoteLine(note: string): string {
  return `Seller's note: ${note}`;
}
