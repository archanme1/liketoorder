import type { NotificationErrorCode } from './api';
import type { PrimerRole } from './primerMoment';
import type { PermissionState } from './pushModule';

export const PRIMER_TITLE = 'Turn on notifications';

export function primerMessage(role: PrimerRole): string {
  return role === 'owner'
    ? "We'll let you know when a new request arrives."
    : "We'll let you know when a place answers your request.";
}

export const PRIMER_PRIVACY =
  'A notification only says what happened. The details open in the app after you sign in.';

export const PRIMER_LATER = 'You can change this any time in Profile.';

/** The Profile row's value, in words. */
export function permissionValue(state: PermissionState): string {
  return { granted: 'On', undetermined: 'Off', denied: 'Off in Settings' }[state];
}

export const PERMISSION_UNDETERMINED = 'Notifications are off.';
export const PERMISSION_DENIED = "Notifications are off in your phone's Settings.";
export const PERMISSION_DENIED_HELP =
  'Open Settings, then Notifications, and turn on Allow Notifications.';

/** Decision 4: the four switches. The last three are for business owners only. */
export const SETTING_LABELS = {
  answers: 'Answers to my requests',
  newRequests: 'New requests',
  cancellations: 'Cancelled requests',
  arrivals: 'Customer arrived',
} as const;

export const SETTING_DESCRIPTIONS = {
  answers: 'When a place accepts or declines your request, or it expires.',
  newRequests: 'When a customer sends your business a pickup or table request.',
  cancellations: 'When a customer cancels a request that was still waiting.',
  arrivals: "When a customer with a table request taps I've arrived.",
} as const;

export function notificationErrorMessage(code: NotificationErrorCode): string {
  switch (code) {
    case 'network':
      return "You're offline. Check your connection and try again.";
    case 'not_signed_in':
      return 'Your session ended. Sign in again.';
    default:
      return 'Something went wrong. Try again.';
  }
}

export const SETTINGS_SAVE_FAILED = "We couldn't save that change. It's back as it was.";
