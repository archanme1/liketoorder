import { useServerClockReading } from './useServerClockReading';

/**
 * Whether the pickup time (or the table time, for a table request) has passed on the SERVER's
 * clock. A hint for showing Completed / No-show only; the server checks again and refuses with
 * invalid_transition. Flips by itself at that time, however far away it is (the timer is capped).
 */
export function usePickupPassed(
  pickupAt: string,
  serverNow: string | undefined,
  fetchedAt: number,
): boolean {
  const at = new Date(pickupAt).getTime();
  const serverMs = useServerClockReading(serverNow, fetchedAt, (now) => (now >= at ? null : at));
  return serverMs !== null && at <= serverMs;
}
