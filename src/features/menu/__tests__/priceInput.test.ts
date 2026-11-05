import { PRICE_ERROR_MESSAGE, parsePrice } from '../price';

// Spec 06 Decision 32: forgiving about form (bare leading separator, non-Latin digits), strict about
// value (thousands separators refused, with a hint).

describe('parsePrice: a bare leading separator', () => {
  it.each([
    ['.5', 2, 50],
    [',5', 2, 50],
    ['.5', 3, 500],
    [',5', 3, 500],
    ['.05', 2, 5],
  ])('reads %s with %d decimals as %d minor units', (text, minorUnits, minor) => {
    expect(parsePrice(text, minorUnits)).toEqual({ ok: true, minor });
  });

  it('refuses ".5" in a 0-decimal currency', () => {
    expect(parsePrice('.5', 0)).toEqual({ ok: false, error: 'too_many_decimals' });
    expect(parsePrice(',5', 0)).toEqual({ ok: false, error: 'too_many_decimals' });
  });

  it('refuses a lone separator and empty text as invalid', () => {
    expect(parsePrice('.', 2)).toEqual({ ok: false, error: 'invalid' });
    expect(parsePrice(',', 2)).toEqual({ ok: false, error: 'invalid' });
    expect(parsePrice('', 2)).toEqual({ ok: false, error: 'invalid' });
    expect(parsePrice('   ', 2)).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('parsePrice: Arabic-Indic and Persian digits', () => {
  it('reads Arabic-Indic digits like Latin ones', () => {
    expect(parsePrice('١٢.٥٠', 2)).toEqual({ ok: true, minor: 1250 });
    expect(parsePrice('١٢٠٠', 0)).toEqual({ ok: true, minor: 1200 });
  });

  it('reads Persian digits like Latin ones', () => {
    expect(parsePrice('۱۲,۵', 2)).toEqual({ ok: true, minor: 1250 });
    expect(parsePrice('۱۲۰۰', 0)).toEqual({ ok: true, minor: 1200 });
  });
});

describe('parsePrice: thousands separators stay refused', () => {
  it('refuses "1,250" in a 2-decimal currency as too many decimals', () => {
    expect(parsePrice('1,250', 2)).toEqual({ ok: false, error: 'too_many_decimals' });
  });

  it('reads "1,250" in a 3-decimal currency as 1.250', () => {
    expect(parsePrice('1,250', 3)).toEqual({ ok: true, minor: 1250 });
  });
});

describe('parsePrice: existing behaviour still holds', () => {
  it('reads ordinary prices', () => {
    expect(parsePrice('12.50', 2)).toEqual({ ok: true, minor: 1250 });
    expect(parsePrice('12,5', 2)).toEqual({ ok: true, minor: 1250 });
    expect(parsePrice('1200', 0)).toEqual({ ok: true, minor: 1200 });
  });

  it('keeps the bounds', () => {
    expect(parsePrice('0', 2)).toEqual({ ok: false, error: 'out_of_range' });
    expect(parsePrice('10000000', 2)).toEqual({ ok: false, error: 'out_of_range' });
  });

  it('refuses letters', () => {
    expect(parsePrice('abc', 2)).toEqual({ ok: false, error: 'invalid' });
    expect(parsePrice('12.5.0', 2)).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('PRICE_ERROR_MESSAGE.too_many_decimals', () => {
  it('says "Use at most 2 decimal places" and warns about thousands separators', () => {
    const message = PRICE_ERROR_MESSAGE.too_many_decimals(2);
    expect(message.startsWith('Use at most 2 decimal places')).toBe(true);
    expect(message).toMatch(/thousands? separator/i);
  });

  it('says "Use at most 1 decimal place" (singular) for 1 decimal', () => {
    const message = PRICE_ERROR_MESSAGE.too_many_decimals(1);
    expect(message.startsWith('Use at most 1 decimal place')).toBe(true);
    expect(message.startsWith('Use at most 1 decimal places')).toBe(false);
    expect(message).toMatch(/thousands? separator/i);
  });

  it('says the currency does not use decimals for 0 decimals', () => {
    expect(PRICE_ERROR_MESSAGE.too_many_decimals(0)).toMatch(/doesn.t use decimals/i);
  });
});
