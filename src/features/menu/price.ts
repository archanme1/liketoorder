// Money is whole minor units (Decision 12): ¥1200 → 1200, $12.50 → 1250, 1.250 KWD → 1250.
// Parsing and pre-filling use string maths only; no parseFloat and no float arithmetic.

export const PRICE_MIN = 1;
export const PRICE_MAX = 999_999_999;

export type PriceError = 'invalid' | 'too_many_decimals' | 'out_of_range';

export type ParsePriceResult = { ok: true; minor: number } | { ok: false; error: PriceError };

export const PRICE_ERROR_MESSAGE: Record<PriceError, (minorUnits: number) => string> = {
  invalid: () => 'Enter a price using numbers only',
  too_many_decimals: (minorUnits) =>
    minorUnits === 0
      ? 'This currency doesn’t use decimals'
      : `Use at most ${minorUnits} decimal ${minorUnits === 1 ? 'place' : 'places'}`,
  out_of_range: () => 'Enter a price above zero and below 1,000,000,000 in the smallest unit',
};

/**
 * Parses a typed price ("12.50", "12,5", "1200") into minor units for a currency with
 * `minorUnits` decimals. Accepts `.` or `,` as the decimal separator; no grouping separators.
 */
export function parsePrice(text: string, minorUnits: number): ParsePriceResult {
  const match = /^(\d+)(?:[.,](\d*))?$/.exec(text.trim());
  if (!match) return { ok: false, error: 'invalid' };
  const [, whole, fraction] = match;
  // "12." with a 0-decimal currency is refused too: the separator implies decimals.
  if (fraction !== undefined && (minorUnits === 0 || fraction.length > minorUnits)) {
    return { ok: false, error: 'too_many_decimals' };
  }
  const digits = (whole + (fraction ?? '').padEnd(minorUnits, '0')).replace(/^0+(?=\d)/, '');
  // At most 9 digits fit the range, so Number() below is exact (a string of integer digits).
  if (digits.length > String(PRICE_MAX).length) return { ok: false, error: 'out_of_range' };
  const minor = Number(digits);
  if (minor < PRICE_MIN || minor > PRICE_MAX) return { ok: false, error: 'out_of_range' };
  return { ok: true, minor };
}

/** "1250" with 2 decimals → "12.50"; with 0 → "1250"; with 3 → "1.250". */
export function minorToDecimalString(minor: number, minorUnits: number): string {
  const digits = String(Math.trunc(Math.abs(minor))).padStart(minorUnits + 1, '0');
  if (minorUnits === 0) return digits;
  return `${digits.slice(0, -minorUnits)}.${digits.slice(-minorUnits)}`;
}

/** The edit form's pre-filled price text (always `.` as the separator). */
export function formatPriceInput(minor: number | null, minorUnits: number): string {
  return minor === null ? '' : minorToDecimalString(minor, minorUnits);
}

/**
 * The price as the viewer's phone shows money: symbol, separators and order from `locale`, and
 * always exactly the ISO 4217 decimals from the currencies table (even where the locale data
 * would show fewer, e.g. IQD).
 */
export function formatPrice(
  minor: number,
  currency: string,
  minorUnits: number,
  locale: string,
): string {
  const format = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: minorUnits,
    maximumFractionDigits: minorUnits,
  });
  // A decimal string, not minor / 10 ** n: Intl formats the exact decimal (and engines without
  // string support convert it with the same digits), so no float maths touches the amount.
  return format.format(minorToDecimalString(minor, minorUnits) as unknown as number);
}
