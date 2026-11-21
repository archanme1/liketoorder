// The headline rules of request_promotion, mirrored (spec 16, 20261120214854_promotions.sql). The
// server judges; this only gives the same answer before sending. Every class is built from escape
// strings, so this file stays ASCII and the characters readable.
import { charCount, hasContactInfo, trimDescription } from '@/features/food-log/text';

export const MAX_HEADLINE_CHARS = 60;

// Refused anywhere (the migration's c_ctrl). Unlike the food-log rule it refuses U+200D, the joiner
// inside combined emoji, and allows the soft hyphen and the direction marks.
const HIDDEN_RANGES = [
  '\\u0000-\\u0009', // ASCII controls before newline, including tab
  '\\u000B-\\u001F', // after newline, including carriage return
  '\\u007F-\\u009F', // DEL and C1 controls
  '\\u200B-\\u200D', // zero-width space, non-joiner, joiner
  '\\u202A-\\u202E', // bidi embeddings and overrides
  '\\u2066-\\u2069', // bidi isolates
  '\\uFEFF', // zero-width no-break space (BOM)
];
const HIDDEN_HEADLINE = new RegExp(`[${HIDDEN_RANGES.join('')}]`, 'u');
const JOINER = new RegExp('\\u200D', 'u');
const LINE_BREAK = /[\n\r]/;

export type HeadlineProblem = 'empty' | 'too_long' | 'hidden' | 'joiner' | 'contact';
export type HeadlineCheck = { ok: true; value: string } | { ok: false; code: HeadlineProblem };

/** One line: Windows and old Mac line ends, newlines and tabs become a space each. */
export function normalizeHeadline(text: string): string {
  return text.replace(/\r\n|[\r\n\t]/g, ' ');
}

/** Code points after trimming, as the server's char_length counts the sent (trimmed) text. */
export function headlineLength(raw: string): number {
  return charCount(trimDescription(raw) ?? '');
}

/**
 * The server's order on the trimmed text: length, hidden characters, line breaks, then contact
 * details. A joiner is a hidden character to the server; it gets its own message here because it
 * usually comes from an emoji, not from pasting.
 */
export function checkHeadline(raw: string): HeadlineCheck {
  // The edge set is the migration's c_edge, the same as the food-log description's.
  const value = trimDescription(raw);
  if (value === null) return { ok: false, code: 'empty' };
  if (charCount(value) > MAX_HEADLINE_CHARS) return { ok: false, code: 'too_long' };
  if (JOINER.test(value)) return { ok: false, code: 'joiner' };
  if (HIDDEN_HEADLINE.test(value) || LINE_BREAK.test(value)) return { ok: false, code: 'hidden' };
  if (hasContactInfo(value)) return { ok: false, code: 'contact' };
  return { ok: true, value };
}
