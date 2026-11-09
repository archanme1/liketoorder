import { DECLINE_REASONS, type DeclineReason } from './schema';

/** The picker's order. "Other" is last and is the only reason that carries the seller's own words. */
export const DECLINE_REASON_ORDER: readonly DeclineReason[] = DECLINE_REASONS;

const LABELS: Record<DeclineReason, string> = {
  sold_out: 'Sold out',
  closed_then: 'Closed at that time',
  too_busy: 'Too busy right now',
  cannot_prepare: "Can't prepare this order",
  time_not_possible: "Pickup time doesn't work",
  other: 'Other',
};

export function declineReasonText(code: DeclineReason): string {
  return LABELS[code];
}

/**
 * What a declined request says as its reason, for both sides. A fixed reason is its label; "Other"
 * is the seller's own words (null if there are none). A request declined before spec 10b has no
 * reason at all: null, so the screen says just "Declined".
 */
export function declineReasonLabel(code: DeclineReason | null, note: string | null): string | null {
  if (code === null) return null;
  if (code === 'other') return note;
  return LABELS[code];
}
