import {
  charCount,
  checkDescription,
  hasContactInfo,
  hasHiddenCharacters,
  normalizeDescription,
  trimDescription,
} from '../text';

// The same cases as supabase/tests/13-food-log-uploads.test.sql section 5. Every special
// character is built from its code point; none is typed.
const cp = (...codes: number[]) => String.fromCodePoint(...codes);

// Every range edge of the hidden class (the pgTAP hidden_check refused list).
const REFUSED_EDGES = [
  1, 9, 11, 13, 31, 127, 128, 159, 173, 1564, 6158, 8203, 8204, 8206, 8207, 8232, 8233, 8234, 8238,
  8288, 8292, 8294, 8297, 65279, 65529, 65531, 917504, 917631,
];
// Their allowed neighbours: newline, U+00A0, U+200D, U+2010, U+2065, U+FE0F, U+FFFC, U+E0080.
const ALLOWED_NEIGHBOURS = [10, 160, 8205, 8208, 8293, 65039, 65532, 917632];

const EMOJI_SEQUENCE = cp(128104, 8205, 127859) + ' ' + cp(10084, 65039);

describe('the hidden-character class', () => {
  it.each(REFUSED_EDGES)('refuses code point %i', (code) => {
    expect(hasHiddenCharacters('a' + cp(code) + 'b')).toBe(true);
  });

  it.each(ALLOWED_NEIGHBOURS)('allows code point %i', (code) => {
    expect(hasHiddenCharacters('a' + cp(code) + 'b')).toBe(false);
  });

  it.each(REFUSED_EDGES.filter((code) => code !== 9))(
    'checkDescription gives invalid_text for code point %i inside the text',
    (code) => {
      expect(checkDescription('a' + cp(code) + 'b')).toEqual({ ok: false, code: 'invalid_text' });
    },
  );

  it.each(ALLOWED_NEIGHBOURS)('checkDescription accepts code point %i inside the text', (code) => {
    const text = 'a' + cp(code) + 'b';
    expect(checkDescription(text)).toEqual({ ok: true, value: text });
  });

  it('accepts an emoji ZWJ sequence with U+FE0F, unchanged', () => {
    expect(checkDescription(EMOJI_SEQUENCE)).toEqual({ ok: true, value: EMOJI_SEQUENCE });
  });

  it('refuses U+202E (bidi override), U+200B, U+2066, U+00AD and a tag character', () => {
    for (const code of [8238, 8203, 8294, 173, 917607]) {
      expect(checkDescription('a' + cp(code) + 'b')).toEqual({ ok: false, code: 'invalid_text' });
    }
  });

  it('refuses the England flag (built from tag characters)', () => {
    const england = cp(127988, 917607, 917602, 917605, 917614, 917607, 917631);
    expect(checkDescription(england)).toEqual({ ok: false, code: 'invalid_text' });
  });
});

describe('normalizing before the checks', () => {
  it('turns a Windows line end into a newline', () => {
    expect(normalizeDescription('line one' + cp(13, 10) + 'line two')).toBe(
      'line one' + cp(10) + 'line two',
    );
    expect(checkDescription('line one' + cp(13, 10) + 'line two')).toEqual({
      ok: true,
      value: 'line one' + cp(10) + 'line two',
    });
  });

  it('turns a tab into a space (the server refuses a tab)', () => {
    expect(normalizeDescription('a' + cp(9) + 'b')).toBe('a b');
    expect(checkDescription('a' + cp(9) + 'b')).toEqual({ ok: true, value: 'a b' });
  });

  it('leaves a lone carriage return, which is refused like the server does', () => {
    expect(normalizeDescription('a' + cp(13) + 'b')).toBe('a' + cp(13) + 'b');
    expect(checkDescription('a' + cp(13) + 'b')).toEqual({ ok: false, code: 'invalid_text' });
  });
});

describe('trimming', () => {
  it('trims edge spaces, including U+00A0, U+3000 and newlines', () => {
    expect(trimDescription(cp(160) + ' trimmed ' + cp(12288, 10))).toBe('trimmed');
  });

  it('trims a leading U+2028 and a trailing U+2029 instead of refusing them', () => {
    expect(checkDescription(cp(8232) + 'x' + cp(8233))).toEqual({ ok: true, value: 'x' });
  });

  it.each([
    ['U+115F', 0x115f],
    ['U+1160', 0x1160],
    ['U+3164', 0x3164],
    ['U+FFA0', 0xffa0],
  ])('trims the Hangul filler %s at either edge, as the server does', (_name, code) => {
    expect(trimDescription(cp(code) + 'kimchi' + cp(code))).toBe('kimchi');
    expect(trimDescription(cp(code))).toBeNull();
    expect(checkDescription(cp(code) + 'kimchi')).toEqual({ ok: true, value: 'kimchi' });
  });

  it('keeps a newline inside', () => {
    const text = 'line one' + cp(10) + 'line two';
    expect(checkDescription(text)).toEqual({ ok: true, value: text });
  });

  it('turns a blank or empty description into null', () => {
    expect(checkDescription('   ')).toEqual({ ok: true, value: null });
    expect(checkDescription('')).toEqual({ ok: true, value: null });
  });
});

describe('length', () => {
  it('accepts 280 characters and refuses 281 with invalid_input', () => {
    expect(checkDescription('y'.repeat(280))).toEqual({ ok: true, value: 'y'.repeat(280) });
    expect(checkDescription('x'.repeat(281))).toEqual({ ok: false, code: 'invalid_input' });
  });

  it('counts code points, so 280 emoji outside the BMP are accepted', () => {
    const text = cp(127859).repeat(280);
    expect(text.length).toBe(560);
    expect(charCount(text)).toBe(280);
    expect(checkDescription(text)).toEqual({ ok: true, value: text });
    expect(checkDescription(text + cp(127859))).toEqual({ ok: false, code: 'invalid_input' });
  });

  it('checks the 1000-character cap first, before the hidden characters', () => {
    expect(checkDescription('x'.repeat(1000) + cp(8238))).toEqual({
      ok: false,
      code: 'invalid_input',
    });
    expect(checkDescription('x'.repeat(1001))).toEqual({ ok: false, code: 'invalid_input' });
  });

  it('at 1000 characters the hidden-character check still runs', () => {
    expect(checkDescription('x'.repeat(999) + cp(8238))).toEqual({
      ok: false,
      code: 'invalid_text',
    });
  });
});

describe('error order: hidden, then length, then contact', () => {
  it('reports a hidden character before the length', () => {
    expect(checkDescription('x'.repeat(300) + cp(8238))).toEqual({
      ok: false,
      code: 'invalid_text',
    });
  });

  it('reports a hidden character before contact info', () => {
    expect(checkDescription('a@b.co ' + cp(8238))).toEqual({ ok: false, code: 'invalid_text' });
  });

  it('reports the length before contact info', () => {
    expect(checkDescription('x'.repeat(275) + ' a@b.co')).toEqual({
      ok: false,
      code: 'invalid_input',
    });
  });
});

describe('contact info', () => {
  it.each([
    'Ate on 2026-11-14',
    'Ate on 2026-11-14, 9 digits 123 456 789',
    'call 123 456 789',
    'ate @ noon. Great',
    'mail me @ b .co later',
    'table for 4 at 7:30, 12 people, order 12345 6789',
  ])('accepts %j', (text) => {
    expect(hasContactInfo(text)).toBe(false);
    expect(checkDescription(text)).toEqual({ ok: true, value: text });
  });

  it.each([
    ['a 10-digit run with dashes', 'call 123-456-7890'],
    ['a 10-digit run with brackets and dots', '(123) [456].7890'],
    ['a 10-digit run split by a newline', '123' + cp(10) + '4567890'],
    ['a 10-digit run split by slashes', '123/456/7890'],
    ['a 10-digit run split by underscores', '123_456_7890'],
    ['a 10-digit run split by commas', '123,456,7890'],
    ['a 10-digit run with a plus', '+1 234 567 890'],
    ['a 10-digit run split by U+2003 and U+3000', '123' + cp(8195) + '456' + cp(12288) + '7890'],
    ['an email', 'a@b.co'],
    ['a mixed-case email', 'write to Me.Here@Example.COM'],
    ['an email with spaces around @', 'a @ b.co'],
    ['an email with a fullwidth @ (U+FF20)', 'a' + cp(65312) + 'b.co'],
    ['a word @ domain', 'dinner @ joes.com'],
    ['two adjacent dates (16 digits, known edge)', '2026-11-14 2026-11-15'],
  ])('refuses %s', (_name, text) => {
    expect(hasContactInfo(text)).toBe(true);
    expect(checkDescription(text)).toEqual({ ok: false, code: 'contact_info' });
  });
});
