import { checkHeadline, headlineLength, MAX_HEADLINE_CHARS, normalizeHeadline } from '../text';

const cp = (...points: number[]) => String.fromCodePoint(...points);

describe('checkHeadline: accepted', () => {
  it('accepts a plain headline and returns it', () => {
    expect(checkHeadline('Fresh tacos every day')).toEqual({
      ok: true,
      value: 'Fresh tacos every day',
    });
  });

  it('trims the server edge set: spaces, no-break and ideographic spaces, Hangul fillers', () => {
    for (const edge of [
      ' ',
      cp(0xa0),
      cp(0x2003),
      cp(0x3000),
      cp(0x3164),
      cp(0xffa0),
      cp(0x202f),
    ]) {
      expect(checkHeadline(`${edge}Tacos${edge}`)).toEqual({ ok: true, value: 'Tacos' });
    }
  });

  it('accepts exactly 60 characters, an emoji outside the BMP counting as one', () => {
    const headline = 'a'.repeat(MAX_HEADLINE_CHARS - 1) + cp(0x1f32e);
    expect(headline.length).toBe(MAX_HEADLINE_CHARS + 1); // UTF-16 units
    expect(checkHeadline(headline).ok).toBe(true);
  });

  it('allows U+FE0F (emoji presentation), which the server allows', () => {
    expect(checkHeadline('Hot ' + cp(0x2615, 0xfe0f) + ' coffee').ok).toBe(true);
  });

  it('allows "2 for 1" and a short number', () => {
    expect(checkHeadline('2 for 1 on all bowls').ok).toBe(true);
    expect(checkHeadline('Open since 1998, 25 dishes').ok).toBe(true);
  });

  it('allows a soft hyphen and a direction mark (only the food-log rule refuses them)', () => {
    expect(checkHeadline('Super' + cp(0xad) + 'food').ok).toBe(true);
    expect(checkHeadline('Shawarma ' + cp(0x200f) + 'plate').ok).toBe(true);
  });
});

describe('checkHeadline: refused', () => {
  it('refuses an empty or blank headline', () => {
    expect(checkHeadline('')).toEqual({ ok: false, code: 'empty' });
    expect(checkHeadline(' ' + cp(0xa0) + ' ')).toEqual({ ok: false, code: 'empty' });
  });

  it('refuses 61 characters after trimming, but not 60 with edge spaces', () => {
    expect(checkHeadline('a'.repeat(61))).toEqual({ ok: false, code: 'too_long' });
    expect(checkHeadline('  ' + 'a'.repeat(60) + '  ').ok).toBe(true);
  });

  it.each([
    ['U+0000', 0x0],
    ['U+0009 (tab)', 0x9],
    ['U+000B', 0xb],
    ['U+000D (carriage return)', 0xd],
    ['U+001F', 0x1f],
    ['U+007F', 0x7f],
    ['U+0080', 0x80],
    ['U+009F', 0x9f],
    ['U+200B', 0x200b],
    ['U+200C', 0x200c],
    ['U+202A', 0x202a],
    ['U+202E', 0x202e],
    ['U+2066', 0x2066],
    ['U+2069', 0x2069],
    ['U+FEFF', 0xfeff],
  ])('refuses the hidden character %s inside the text', (_name, point) => {
    expect(checkHeadline('Taco' + cp(point) + 'night')).toEqual({ ok: false, code: 'hidden' });
  });

  it('refuses a newline inside the text', () => {
    expect(checkHeadline('Taco' + cp(0x0a) + 'night')).toEqual({ ok: false, code: 'hidden' });
  });

  it('refuses U+200D with its own emoji message (woman cook, family)', () => {
    const womanCook = cp(0x1f469, 0x200d, 0x1f373);
    expect(checkHeadline('Meet our ' + womanCook)).toEqual({ ok: false, code: 'joiner' });
    expect(checkHeadline(cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467) + ' meals')).toEqual({
      ok: false,
      code: 'joiner',
    });
  });

  it('keeps the characters just outside each range allowed', () => {
    for (const point of [0x200a, 0x200e, 0x2029, 0x202f, 0x2065, 0x206a, 0xfefe, 0xa0]) {
      expect(checkHeadline('Taco' + cp(point) + 'night').ok).toBe(true);
    }
  });

  it('refuses an email, with spaces around @ or a fullwidth @, in any case', () => {
    for (const text of [
      'Write to tacos@example.com',
      'Write to TACOS@EXAMPLE.COM',
      'Write to tacos @ example.ca',
      'Write to tacos' + cp(0xff20) + 'example.ca',
    ]) {
      expect(checkHeadline(text)).toEqual({ ok: false, code: 'contact' });
    }
  });

  it('refuses 10 or more digits once separators are ignored', () => {
    for (const text of [
      'Call 416 555 0199',
      'Call (416) 555-0199',
      'Call 416.555.0199',
      '4165550199',
    ]) {
      expect(checkHeadline(text)).toEqual({ ok: false, code: 'contact' });
    }
  });

  it('allows 9 digits with separators', () => {
    expect(checkHeadline('Order 416 555 019').ok).toBe(true);
  });
});

describe('normalizeHeadline and headlineLength', () => {
  it('turns every line end and tab into one space each', () => {
    const lf = cp(0x0a);
    const cr = cp(0x0d);
    const tab = cp(0x09);
    expect(normalizeHeadline(`Tacos${cr}${lf}every${lf}day${cr}now${tab}!`)).toBe(
      'Tacos every day now !',
    );
  });

  it('counts code points after trimming', () => {
    expect(headlineLength('  Taco ' + cp(0x1f32e) + '  ')).toBe(6);
    expect(headlineLength('   ')).toBe(0);
  });
});
