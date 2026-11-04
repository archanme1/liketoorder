import type { SellerErrorCode } from './api';

export const ADDRESS_PRIVACY_NOTE =
  'Your exact address stays private. The map shows an approximate area.';

export function sellerErrorMessage(code: SellerErrorCode): string {
  switch (code) {
    case 'already_has_business':
      return 'You already have a business on this account.';
    case 'no_business':
      return 'We couldn’t find your business. Start selling from your Profile.';
    case 'profile_incomplete':
      return 'Finish setting up your profile first.';
    case 'rate_limited':
      return 'Too many address searches. Wait a moment and try again.';
    case 'not_a_place':
      return 'That suggestion isn’t a full address. Pick another one.';
    case 'invalid_input':
      return 'Some details aren’t valid. Check them and try again.';
    case 'network':
      return 'Can’t reach LikeToOrder. Check your connection and try again.';
    case 'unknown':
      return 'Something went wrong. Please try again.';
  }
}
