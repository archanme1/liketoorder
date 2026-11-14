// Where to send a guest after they sign in: set by the Request pickup and Request table buttons
// and by the notification tap resolver (spec 12),
// read by the root navigator once the profile is complete, cleared by the form when it opens, and
// cleared when the sign-in screens close without a session (useClearReturnToOnLeave). Kept in
// memory only: if the app is killed mid-sign-in the guest lands on Profile.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// Only the pickup or table request form for a business id. Anything else is refused, so a crafted
// value can never send a user somewhere unexpected.
const ALLOWED = new RegExp(`^/requests/(?:table/)?new\\?businessId=${UUID}$`, 'i');
// Spec 12: a notification tapped while signed out resumes at the tap resolver. Exactly this shape:
// these four keys in this order, version 1, a uuid (either case), the exact kind and side words.
const UUID_ANY_CASE = UUID.replace(/a-f/g, 'a-fA-F');
const NOTIFICATION_OPEN = new RegExp(
  `^/notifications/open\\?v=1&kind=(?:pickup|table)&id=${UUID_ANY_CASE}&side=(?:sent|received)$`,
);

/** A stale value from an abandoned sign-in must not hijack a later, unrelated sign-in. */
export const RETURN_TO_TTL_MS = 10 * 60_000;

let pending: { href: string; at: number } | null = null;

export function requestFormHref(businessId: string): string {
  return `/requests/new?businessId=${businessId}`;
}

export function tableRequestFormHref(businessId: string): string {
  return `/requests/table/new?businessId=${businessId}`;
}

/** The tap resolver for one notification, keys always in the same order. */
export function notificationOpenHref(target: {
  kind: 'pickup' | 'table';
  id: string;
  side: 'sent' | 'received';
}): string {
  return `/notifications/open?v=1&kind=${target.kind}&id=${target.id}&side=${target.side}`;
}

/** Remembers `href` if it is an allowed destination. Returns whether it was kept. */
export function setReturnTo(href: string, now: number = Date.now()): boolean {
  if (!ALLOWED.test(href) && !NOTIFICATION_OPEN.test(href)) return false;
  pending = { href, at: now };
  return true;
}

/**
 * Where to go after sign-in, or null. Pure: it changes nothing, so it is safe to call while a
 * screen renders (React may render twice or skip a render). An expired value is simply not
 * returned; `clearReturnTo` is what forgets it.
 */
export function peekReturnTo(now: number = Date.now()): string | null {
  if (pending === null || now - pending.at > RETURN_TO_TTL_MS) return null;
  return pending.href;
}

export function clearReturnTo(): void {
  pending = null;
}
