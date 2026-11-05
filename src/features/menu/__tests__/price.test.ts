import { formatPrice, formatPriceInput, parsePrice } from '../price';
import { GALLERY_LIMIT, ITEM_LIMIT, MENU_PHOTO_LIMIT } from '../schema';

// Spec 06 "Price model (Decision 12)": integers in the currency's minor unit (0, 2 or 3 decimals),
// `.` or `,` as the separator, string maths only, bounds 1..999 999 999.

// Intl puts a no-break (U+00A0) or narrow no-break (U+202F) space in some formats; compare as a
// plain space so the test doesn't depend on which one the ICU version emits.
function plain(text: string): string {
  return text.replace(/[  ]/g, ' ');
}

describe('limits named in the spec', () => {
  it('uses 100 items, 6 gallery photos and 10 menu photos', () => {
    expect(ITEM_LIMIT).toBe(100);
    expect(GALLERY_LIMIT).toBe(6);
    expect(MENU_PHOTO_LIMIT).toBe(10);
  });
});

describe('parsePrice: 0-decimal currencies (JPY)', () => {
  it('reads whole numbers as the amount itself', () => {
    expect(parsePrice('1200', 0)).toEqual({ ok: true, minor: 1200 });
    expect(parsePrice('1', 0)).toEqual({ ok: true, minor: 1 });
  });

  it('refuses a decimal part', () => {
    expect(parsePrice('1200.5', 0)).toEqual({ ok: false, error: 'too_many_decimals' });
    expect(parsePrice('1200,50', 0)).toEqual({ ok: false, error: 'too_many_decimals' });
  });
});

describe('parsePrice: 2-decimal currencies (EUR, CAD)', () => {
  it.each([
    ['12.50', 1250],
    ['12,50', 1250],
    ['12.5', 1250],
    ['12,5', 1250],
    ['12', 1200],
    ['0.29', 29],
    ['0,29', 29],
    ['0.05', 5],
    ['0.01', 1],
  ])('reads %s as %d minor units', (text, minor) => {
    expect(parsePrice(text, 2)).toEqual({ ok: true, minor });
  });

  it('refuses more than 2 decimals', () => {
    expect(parsePrice('12.505', 2)).toEqual({ ok: false, error: 'too_many_decimals' });
    expect(parsePrice('12,555', 2)).toEqual({ ok: false, error: 'too_many_decimals' });
  });
});

describe('parsePrice: 3-decimal currencies (KWD)', () => {
  it.each([
    ['1.250', 1250],
    ['1,250', 1250],
    ['1.25', 1250],
    ['1', 1000],
    ['0.001', 1],
    ['1.005', 1005],
  ])('reads %s as %d minor units', (text, minor) => {
    expect(parsePrice(text, 3)).toEqual({ ok: true, minor });
  });

  it('refuses more than 3 decimals', () => {
    expect(parsePrice('1.2505', 3)).toEqual({ ok: false, error: 'too_many_decimals' });
  });
});

describe('parsePrice: bounds 1..999 999 999', () => {
  it('accepts the smallest and largest amounts', () => {
    expect(parsePrice('1', 0)).toEqual({ ok: true, minor: 1 });
    expect(parsePrice('999999999', 0)).toEqual({ ok: true, minor: 999_999_999 });
    expect(parsePrice('9999999.99', 2)).toEqual({ ok: true, minor: 999_999_999 });
    expect(parsePrice('999999.999', 3)).toEqual({ ok: true, minor: 999_999_999 });
  });

  it('refuses zero in every currency', () => {
    expect(parsePrice('0', 0)).toEqual({ ok: false, error: 'out_of_range' });
    expect(parsePrice('0.00', 2)).toEqual({ ok: false, error: 'out_of_range' });
    expect(parsePrice('0,000', 3)).toEqual({ ok: false, error: 'out_of_range' });
  });

  it('refuses one above the largest amount', () => {
    expect(parsePrice('1000000000', 0)).toEqual({ ok: false, error: 'out_of_range' });
    expect(parsePrice('10000000.00', 2)).toEqual({ ok: false, error: 'out_of_range' });
    expect(parsePrice('1000000.000', 3)).toEqual({ ok: false, error: 'out_of_range' });
  });

  it('refuses very long digit strings without rounding them into range', () => {
    expect(parsePrice('99999999999999999999', 0)).toEqual({ ok: false, error: 'out_of_range' });
  });
});

describe('parsePrice: not a price', () => {
  it.each(['', 'abc', '-5', '1e3', '1.2.3', '12,50,1', '$12.50', '1 200'])(
    'refuses %j as invalid',
    (text) => {
      const result = parsePrice(text, 2);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('invalid');
    },
  );
});

describe('parsePrice: no float maths', () => {
  it('never calls parseFloat', () => {
    const globalSpy = jest.spyOn(globalThis, 'parseFloat');
    const numberSpy = jest.spyOn(Number, 'parseFloat');
    parsePrice('12.50', 2);
    parsePrice('0.29', 2);
    parsePrice('1.005', 3);
    parsePrice('1200', 0);
    formatPriceInput(1250, 2);
    expect(globalSpy).not.toHaveBeenCalled();
    expect(numberSpy).not.toHaveBeenCalled();
    globalSpy.mockRestore();
    numberSpy.mockRestore();
  });

  it('gives the exact integer where floats would be off', () => {
    // 0.29 * 100 === 28.999999999999996 and 1.005 * 1000 === 1004.9999999999999 in floats.
    expect(parsePrice('0.29', 2)).toEqual({ ok: true, minor: 29 });
    expect(parsePrice('1.005', 3)).toEqual({ ok: true, minor: 1005 });
    expect(parsePrice('4.35', 2)).toEqual({ ok: true, minor: 435 });
    expect(parsePrice('8.20', 2)).toEqual({ ok: true, minor: 820 });
  });
});

describe('formatPrice', () => {
  it('formats JPY 1200 as ¥1,200 in en-US (0 decimals)', () => {
    expect(plain(formatPrice(1200, 'JPY', 0, 'en-US'))).toBe('¥1,200');
  });

  it('formats EUR 1250 as 12,50 € in de-DE', () => {
    expect(plain(formatPrice(1250, 'EUR', 2, 'de-DE'))).toBe('12,50 €');
  });

  it('formats KWD 1250 as KWD 1.250 in en-US (3 decimals)', () => {
    expect(plain(formatPrice(1250, 'KWD', 3, 'en-US'))).toBe('KWD 1.250');
  });

  it('formats USD 1250 as $12.50 in en-US', () => {
    expect(plain(formatPrice(1250, 'USD', 2, 'en-US'))).toBe('$12.50');
  });

  it('always shows exactly the ISO decimals, even where the locale would show fewer', () => {
    // CLDR shows IQD with 0 decimals; the currencies table says 3.
    expect(plain(formatPrice(1250, 'IQD', 3, 'en-US'))).toMatch(/1\.250$/);
  });

  it('keeps trailing zeros', () => {
    expect(plain(formatPrice(1200, 'EUR', 2, 'de-DE'))).toBe('12,00 €');
    expect(plain(formatPrice(5, 'USD', 2, 'en-US'))).toBe('$0.05');
  });

  it('formats the largest amount exactly', () => {
    expect(plain(formatPrice(999_999_999, 'EUR', 2, 'en-US'))).toBe('€9,999,999.99');
  });
});

describe('formatPriceInput', () => {
  it('is empty for no price', () => {
    expect(formatPriceInput(null, 2)).toBe('');
    expect(formatPriceInput(null, 0)).toBe('');
  });

  it('pre-fills with the right number of decimals', () => {
    expect(formatPriceInput(1200, 0)).toBe('1200');
    expect(formatPriceInput(1250, 2)).toBe('12.50');
    expect(formatPriceInput(1250, 3)).toBe('1.250');
    expect(formatPriceInput(5, 2)).toBe('0.05');
  });

  it('round-trips through parsePrice', () => {
    for (const [minor, mu] of [
      [1, 0],
      [1, 2],
      [29, 2],
      [1005, 3],
      [999_999_999, 2],
    ] as const) {
      expect(parsePrice(formatPriceInput(minor, mu), mu)).toEqual({ ok: true, minor });
    }
  });
});
