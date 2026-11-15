// The description rules of begin_food_log_upload and update_food_log, mirrored exactly (spec 13
// Decisions 2, 11, 26, 27). The server judges; this only gives the same answer before sending.
// Every class is built from escape strings, so this file stays ASCII and the characters readable.

export const MAX_RAW_CHARS = 1000;
export const MAX_DESCRIPTION_CHARS = 280;

// Trimmed from both ends (c_edge): space, newline, no-break and Unicode spaces, line and paragraph
// separators, Hangul fillers.
const EDGE_CHARS = [
  ' ',
  '\\n',
  '\\u00A0',
  '\\u115F',
  '\\u1160',
  '\\u1680',
  '\\u2000-\\u200A',
  '\\u2028',
  '\\u2029',
  '\\u202F',
  '\\u205F',
  '\\u3000',
  '\\u3164',
  '\\uFFA0',
].join('');
const EDGE = new RegExp(`^[${EDGE_CHARS}]+|[${EDGE_CHARS}]+$`, 'gu');

// Refused anywhere (c_hidden). U+200D and U+FE0F are allowed, so emoji sequences work.
const HIDDEN_RANGES = [
  '\\u0000-\\u0009', // ASCII controls except newline (U+000A), including tab
  '\\u000B-\\u001F', // including carriage return
  '\\u007F-\\u009F', // DEL and C1 controls
  '\\u00AD', // soft hyphen
  '\\u061C', // Arabic letter mark
  '\\u180E', // Mongolian vowel separator
  '\\u200B', // zero-width space
  '\\u200C', // zero-width non-joiner
  '\\u200E', // left-to-right mark
  '\\u200F', // right-to-left mark
  '\\u2028', // line separator
  '\\u2029', // paragraph separator
  '\\u202A-\\u202E', // bidi embeddings and overrides
  '\\u2060-\\u2064', // word joiner, invisible operators
  '\\u2066-\\u2069', // bidi isolates
  '\\uFEFF', // zero-width no-break space (BOM)
  '\\uFFF9-\\uFFFB', // interlinear annotation marks
  '\\u{E0000}-\\u{E007F}', // tags
];
export const HIDDEN_FOOD_LOG = new RegExp(`[${HIDDEN_RANGES.join('')}]`, 'u');

// An email (c_mail): spaces allowed around @ or a fullwidth @ (U+FF20), none inside the domain.
// The server matches case-insensitively; the letters are spelled out here instead of the `i` flag,
// which under `u` would also match U+017F and U+212A by case folding.
const MAIL_SPACES = '[ \\u00A0\\u2000-\\u200A\\u202F\\u3000]*';
const EMAIL = new RegExp(
  `[A-Za-z0-9._%+-]+${MAIL_SPACES}[@\\uFF20]${MAIL_SPACES}[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}`,
  'u',
);

// Ignored between digits (c_sep): whitespace and . ( ) [ ] - / _ , +
const SEPARATORS = new RegExp(
  '[\\][ \\n\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000.()/_,+-]',
  'gu',
);
const DIGIT_RUN = /[0-9]{10,}/;

export type DescriptionProblem = 'invalid_input' | 'invalid_text' | 'contact_info';
export type DescriptionCheck =
  { ok: true; value: string | null } | { ok: false; code: DescriptionProblem };

/** Windows line ends become newlines and tabs become spaces (both are hidden characters). */
export function normalizeDescription(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\t/g, ' ');
}

/** Code points, as Postgres char_length counts them (an emoji outside the BMP is one). */
export function charCount(text: string): number {
  return Array.from(text).length;
}

/** Edge spaces trimmed; a blank text becomes null. */
export function trimDescription(text: string): string | null {
  const trimmed = text.replace(EDGE, '');
  return trimmed === '' ? null : trimmed;
}

export function hasHiddenCharacters(text: string): boolean {
  return HIDDEN_FOOD_LOG.test(text);
}

export function hasContactInfo(text: string): boolean {
  return EMAIL.test(text) || DIGIT_RUN.test(text.replace(SEPARATORS, ''));
}

/**
 * The server's order: the 1000 cap on the text as sent, then trim, then hidden characters, then
 * the 280 limit, then contact info. The text is normalized first, as the app sends it.
 */
export function checkDescription(raw: string): DescriptionCheck {
  const text = normalizeDescription(raw);
  if (charCount(text) > MAX_RAW_CHARS) return { ok: false, code: 'invalid_input' };
  const value = trimDescription(text);
  if (value === null) return { ok: true, value };
  if (hasHiddenCharacters(value)) return { ok: false, code: 'invalid_text' };
  if (charCount(value) > MAX_DESCRIPTION_CHARS) return { ok: false, code: 'invalid_input' };
  if (hasContactInfo(value)) return { ok: false, code: 'contact_info' };
  return { ok: true, value };
}
