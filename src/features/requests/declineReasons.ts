import {
  DECLINE_REASONS,
  TABLE_DECLINE_REASONS,
  type DeclineReason,
  type TableDeclineReason,
} from './schema';
import type { RequestKind } from './kind';

/** The picker's order. "Other" is last and is the only reason that carries the seller's own words. */
export const DECLINE_REASON_ORDER: readonly DeclineReason[] = DECLINE_REASONS;
/** The same for a table request (spec 11). */
export const TABLE_DECLINE_REASON_ORDER: readonly TableDeclineReason[] = TABLE_DECLINE_REASONS;

const LABELS: Record<DeclineReason, string> = {
  sold_out: 'Sold out',
  closed_then: 'Closed at that time',
  too_busy: 'Too busy right now',
  cannot_prepare: "Can't prepare this order",
  time_not_possible: "Pickup time doesn't work",
  other: 'Other',
};

const TABLE_LABELS: Record<TableDeclineReason, string> = {
  fully_booked: 'Fully booked',
  closed_then: 'Closed at that time',
  too_busy: 'Too busy right now',
  time_not_possible: "Time doesn't work",
  other: 'Other',
};

export function declineReasonText(code: DeclineReason): string {
  return LABELS[code];
}

export function tableDeclineReasonText(code: TableDeclineReason): string {
  return TABLE_LABELS[code];
}

/** The reason's words for a request of this kind. A code of the other kind falls back to its code. */
function reasonText(kind: RequestKind, code: DeclineReason | TableDeclineReason): string {
  const labels: Record<string, string> = kind === 'table' ? TABLE_LABELS : LABELS;
  return labels[code] ?? code;
}

/**
 * What a declined request says as its reason, for both sides. A fixed reason is its label; "Other"
 * is the seller's own words (null if there are none). A request declined before spec 10b has no
 * reason at all: null, so the screen says just "Declined".
 */
export function declineReasonLabel(
  kind: RequestKind,
  code: DeclineReason | TableDeclineReason | null,
  note: string | null,
): string | null {
  if (code === null) return null;
  if (code === 'other') return note;
  return reasonText(kind, code);
}
