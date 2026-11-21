import type { OfferErrorCode, PromotionErrorCode } from './api';
import type { OfferDistance, OfferType, PromotionCategory, RejectReason } from './schema';

// Plain words for sellers. No message carries the headline or any server text, and none names a
// person.

export const CATEGORY_LABELS: Record<PromotionCategory, string> = {
  new_dish: 'New on the menu',
  special_offer: 'Special offer',
  featured: 'Featured',
};

export const REQUESTED_TEXT = "Waiting for review. We'll contact you about payment.";
export const CANCELLED_TEXT = 'Cancelled.';
export const ASAP_LABEL = 'As soon as possible';
export const START_NOTE = "We'll confirm the exact dates after payment.";
export const PAYMENT_NOTE = "Nothing is charged in the app. We'll contact you about payment.";

export const REJECT_REASON_TEXT: Record<RejectReason, string> = {
  headline: "the headline can't be used. You can send a new request with another one.",
  not_paid: "the invoice wasn't paid.",
  not_eligible: "this business can't be promoted right now.",
  other: "the request couldn't be accepted.",
};

export function promotionErrorMessage(code: PromotionErrorCode): string {
  switch (code) {
    case 'not_authenticated':
      return 'Your session has ended. Sign in again to promote your business.';
    case 'not_eligible':
      return 'Your business needs to be listed and showing on the map before you can promote it.';
    case 'not_configured':
      return "Promotions aren't available yet.";
    case 'already_open':
      return 'You already have a promotion request or campaign. This screen now shows it.';
    case 'too_many_requests':
      return "You've sent several requests today. Try again tomorrow.";
    case 'invalid_headline':
      return "This headline can't be used. Keep it to one line of up to 60 characters, with no phone numbers, emails or hidden characters.";
    case 'invalid_category':
      return 'Choose a category.';
    case 'invalid_start':
      return "That start day can't be used any more. Pick another one.";
    case 'not_found':
      return "This promotion can't be found any more.";
    case 'not_cancellable':
      return 'This promotion has already ended or been cancelled.';
    case 'network':
      return "Can't reach LikeToOrder. Check your connection and try again.";
    case 'unknown':
      return 'Something went wrong. Please try again.';
  }
}

// -- Offers (spec 16 PR 4) -----------------------------------------------------------------
// Plain words for customers and guests. No message carries a position, a filter value or server
// text.

export const OFFER_TYPE_LABELS: Record<OfferType, string> = {
  restaurant: 'Restaurant',
  homemade: 'Home cook',
};

export const OFFER_DISTANCE_LABELS: Record<OfferDistance, string> = {
  5: 'About 5 km',
  15: 'About 15 km',
  30: 'About 30 km',
};

export const OFFERS_TITLE = 'Offers';
export const OFFERS_EMPTY_TEXT =
  'No offers near you right now. Check back later or browse the map.';
export const BROWSE_MAP_LABEL = 'Browse the map';
export const OFFERS_END_TEXT = "That's all the offers near here.";
export const OFFERS_LOADING_LABEL = 'Loading offers';
export const OFFERS_LOADING_MORE = 'Loading more offers';
export const OFFERS_MORE_FAILED = "Couldn't load more offers.";
export const OFFERS_REFRESH_FAILED = "Couldn't refresh. Pull to try again.";
export const OFFER_ENDED_TEXT = "This offer has ended or the place isn't available right now.";
export const OFFER_CARD_HINT = 'Opens it on the map';

export function offerErrorMessage(code: OfferErrorCode): string {
  switch (code) {
    case 'invalid_point':
    case 'invalid_distance':
    case 'invalid_filter':
    case 'invalid_cursor':
      return "We couldn't load offers for this area. Try again, or change the area.";
    case 'rate_limited':
      return "You're looking around very quickly. Wait a minute, then try again.";
    case 'network':
      return "Can't reach LikeToOrder. Check your connection and try again.";
    case 'unknown':
      return 'Something went wrong. Please try again.';
  }
}
