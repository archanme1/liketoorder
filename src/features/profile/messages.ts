import type { ProfileErrorCode } from './api';

export const USERNAME_TAKEN = 'Username is taken';

export function profileErrorMessage(code: ProfileErrorCode): string {
  switch (code) {
    case 'username_taken':
      return USERNAME_TAKEN;
    case 'invalid_field':
      return 'Some details aren’t valid. Check the fields and try again.';
    case 'not_signed_in':
      return 'You’re signed out. Sign in and try again.';
    case 'not_found':
      return 'We couldn’t find your profile.';
    case 'network':
      return 'Can’t reach LikeToOrder. Check your connection and try again.';
    case 'unknown':
      return 'Something went wrong. Please try again.';
  }
}

/** Field-level message for a DB check failure the form's zod rules didn't catch. */
export const INVALID_FIELD_MESSAGE = 'This value isn’t allowed';
