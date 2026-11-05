import { MediaError, mediaErrorMessage } from '@/features/media/errors';

import { MenuAppError, type MenuErrorCode } from './api';

export function menuErrorMessage(code: MenuErrorCode): string {
  switch (code) {
    case 'no_business':
      return 'We couldn’t find your business. Start selling from your Profile.';
    case 'item_limit':
      return 'Your menu has reached the limit of 100 items. Delete an item to add another.';
    case 'photo_limit':
      return 'This section is full. Remove a photo to add another.';
    case 'currency_required':
      return 'Choose a currency before adding prices.';
    case 'prices_exist':
      return 'The currency can’t change while items have prices. Remove the prices first.';
    case 'not_found':
      return 'That item or photo no longer exists.';
    case 'upload_missing':
      return 'The photo didn’t finish uploading. Please try again.';
    case 'invalid_input':
      return 'Some details aren’t valid. Check them and try again.';
    case 'cleanup_required':
      return 'We’re tidying up old photos. Try again in a moment.';
    case 'network':
      return 'Can’t reach LikeToOrder. Check your connection and try again.';
    case 'unknown':
      return 'Something went wrong. Please try again.';
  }
}

/** A message for any error from the photo flow (media or menu functions). */
export function photoErrorMessage(error: unknown): string {
  if (error instanceof MediaError) return mediaErrorMessage(error.code);
  if (error instanceof MenuAppError) return menuErrorMessage(error.code);
  return menuErrorMessage('unknown');
}

export const CURRENCY_LOCKED_REASON =
  'The currency can’t change while items have prices. Remove the prices to change it.';
export const ITEM_LIMIT_REASON = 'Your menu has 100 items, the limit. Delete one to add another.';
export const HOMEMADE_PHOTO_NOTE =
  'Photos are public. Avoid showing your house number, front door or street sign.';
export const MENU_PHOTOS_HINT =
  'Screen readers can’t read text in menu photos. Adding menu items too helps everyone.';
