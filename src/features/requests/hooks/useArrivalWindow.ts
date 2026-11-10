import { useServerClockReading } from './useServerClockReading';

const HOUR_MS = 3_600_000;
/** "I've arrived" opens 2 hours before the table time and closes 4 hours after it (both ends allowed). */
export const ARRIVAL_OPENS_BEFORE_MS = 2 * HOUR_MS;
export const ARRIVAL_CLOSES_AFTER_MS = 4 * HOUR_MS;

export type ArrivalWindow = 'before' | 'open' | 'after';

/** Where "now" on the SERVER's clock falls against the arrival window of a table time. */
export function arrivalWindowAt(tableAt: string, serverNowMs: number): ArrivalWindow {
  const at = new Date(tableAt).getTime();
  if (serverNowMs < at - ARRIVAL_OPENS_BEFORE_MS) return 'before';
  if (serverNowMs > at + ARRIVAL_CLOSES_AFTER_MS) return 'after';
  return 'open';
}

/**
 * Whether the arrival window is open, judged on the SERVER's clock (see useServerClockReading: the
 * phone's clock only schedules the next look, to the moment the window opens or closes). A hint for
 * showing the button only: the server checks again and refuses with arrival_window.
 */
export function useArrivalWindow(
  tableAt: string,
  serverNow: string | undefined,
  fetchedAt: number,
): ArrivalWindow {
  const at = new Date(tableAt).getTime();
  const serverMs = useServerClockReading(serverNow, fetchedAt, (now) => {
    const state = arrivalWindowAt(tableAt, now);
    if (state === 'before') return at - ARRIVAL_OPENS_BEFORE_MS;
    return state === 'open' ? at + ARRIVAL_CLOSES_AFTER_MS + 1 : null;
  });
  return serverMs === null ? 'before' : arrivalWindowAt(tableAt, serverMs);
}
