import { MediaError, mediaErrorMessage } from '@/features/media/errors';

import { FoodLogAppError, type FoodLogErrorCode } from './api';
import { DESCRIPTION_CONTACT, DESCRIPTION_HIDDEN } from './schema';

export const FOOD_LOG_NOT_FOUND = "This photo isn't available.";

export function foodLogErrorMessage(code: FoodLogErrorCode): string {
  switch (code) {
    case 'profile_incomplete':
      return 'Finish your profile before adding photos.';
    case 'invalid_input':
      return "Some details aren't valid. Check them and try again.";
    case 'invalid_text':
      return DESCRIPTION_HIDDEN;
    case 'contact_info':
      return DESCRIPTION_CONTACT;
    case 'invalid_time_zone':
      return "Your phone's time zone wasn't recognised. Check your date and time settings.";
    case 'too_many_pending':
      return 'Some photos are still uploading. Wait for them to finish, then try again.';
    case 'daily_limit':
      return "You've added a lot of photos today. Try again tomorrow.";
    case 'cleanup_required':
      return "We're tidying up old photos. Try again in a moment.";
    case 'not_found':
      return FOOD_LOG_NOT_FOUND;
    case 'upload_missing':
      return "The photo didn't finish uploading. Please try again.";
    case 'network':
      return "Can't reach LikeToOrder. Check your connection and try again.";
    case 'unknown':
      return 'Something went wrong. Please try again.';
  }
}

/** A message for any error from the food log flow (media or food log functions). */
export function foodLogFlowMessage(error: unknown): string {
  if (error instanceof MediaError) return mediaErrorMessage(error.code);
  if (error instanceof FoodLogAppError) return foodLogErrorMessage(error.code);
  return foodLogErrorMessage('unknown');
}

export const FOOD_LOG_EMPTY = 'No food photos yet. Add your first one.';
export const DESCRIPTION_HINT = "Don't add phone numbers, emails or addresses.";
export const PUBLIC_ON = 'Anyone signed in can see this';
export const PUBLIC_OFF = 'Only you can see this';
export const DELETE_TITLE = 'Delete this photo?';
export const DELETE_MESSAGE = "This can't be undone.";
export const PHOTO_REQUIRED_REASON = 'Choose a photo first.';
export const CUISINE_REQUIRED_REASON = 'Choose a cuisine first.';
export const LOAD_MORE_ERROR = "Couldn't load more photos.";
export const NO_DESCRIPTION = 'No description';
