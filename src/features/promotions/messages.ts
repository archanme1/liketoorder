import type { PromotionErrorCode } from './api';
import type { PromotionCategory, RejectReason } from './schema';

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
