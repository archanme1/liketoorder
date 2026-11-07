// Where to send a guest after they sign in: set by the "Request pickup" button, read by the root
// navigator once the profile is complete, cleared by the form when it opens. Kept in memory only:
// if the app is killed mid-sign-in (say during email verification) the guest lands on Profile.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// Only the request form for a business id. Anything else is refused, so a crafted value can
// never send a user somewhere unexpected.
const ALLOWED = new RegExp(`^/requests/new\\?businessId=${UUID}$`, 'i');

/** A stale value from an abandoned sign-in must not hijack a later, unrelated sign-in. */
export const RETURN_TO_TTL_MS = 10 * 60_000;

let pending: { href: string; at: number } | null = null;

export function requestFormHref(businessId: string): string {
  return `/requests/new?businessId=${businessId}`;
}

/** Remembers `href` if it is an allowed destination. Returns whether it was kept. */
export function setReturnTo(href: string, now: number = Date.now()): boolean {
  if (!ALLOWED.test(href)) return false;
  pending = { href, at: now };
  return true;
}

export function peekReturnTo(now: number = Date.now()): string | null {
  if (pending === null) return null;
  if (now - pending.at > RETURN_TO_TTL_MS) {
    pending = null;
    return null;
  }
  return pending.href;
}

export function clearReturnTo(): void {
  pending = null;
}
