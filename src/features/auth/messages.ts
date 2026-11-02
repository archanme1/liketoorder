import type { AuthErrorCode } from './api';

// One place for auth copy so the "never reveal whether an email exists" wording stays consistent.

export const VERIFY_EMAIL_HINT =
  'Didn’t get a code? If you already have an account, try signing in or resetting your password.';

export const RESET_CODE_SENT =
  'If an account exists for that email, we sent a code. It can take a minute to arrive.';

export const RESEND_DONE = 'If a code was needed, we sent a new one. Check your email.';

export const PASSWORD_UPDATED = 'Password updated. You’re signed in.';

export const INVALID_CODE = 'That code isn’t right';

export const SIGN_IN_FAILED = 'Email or password is incorrect';

export function authErrorMessage(code: AuthErrorCode): string {
  switch (code) {
    case 'invalid_credentials':
      return SIGN_IN_FAILED;
    case 'invalid_code':
      return INVALID_CODE;
    case 'weak_password':
      return 'Choose a stronger password you haven’t used here before.';
    case 'rate_limited':
      return 'Too many attempts. Wait a minute and try again.';
    case 'network':
      return 'Can’t reach LikeToOrder. Check your connection and try again.';
    case 'email_not_confirmed':
      return 'Confirm your email to continue.';
    case 'unknown':
      return 'Something went wrong. Please try again.';
  }
}
