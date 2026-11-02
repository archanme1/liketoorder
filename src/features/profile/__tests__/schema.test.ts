import {
  BIO_MAX,
  CITY_MAX,
  DISPLAY_NAME_MAX,
  USERNAME_HINT,
  USERNAME_MAX,
  USERNAME_MIN,
  bioSchema,
  citySchema,
  displayNameSchema,
  editProfileSchema,
  setupProfileSchema,
  usernameSchema,
} from '../schema';

describe('profile schema constants (must equal the DB checks)', () => {
  it('matches the database boundaries', () => {
    expect(USERNAME_MIN).toBe(3);
    expect(USERNAME_MAX).toBe(20);
    expect(DISPLAY_NAME_MAX).toBe(50);
    expect(BIO_MAX).toBe(160);
    expect(CITY_MAX).toBe(60);
    expect(typeof USERNAME_HINT).toBe('string');
    expect(USERNAME_HINT.length).toBeGreaterThan(0);
  });
});

describe('usernameSchema', () => {
  it.each(['abc', 'a'.repeat(20), 'user_name_1', '___', '123'])('accepts %s', (value) => {
    expect(usernameSchema.safeParse(value).success).toBe(true);
  });

  it.each(['ab', 'a'.repeat(21), 'has space', 'dash-es', 'dot.s', 'émile', ''])(
    'rejects %j',
    (value) => {
      expect(usernameSchema.safeParse(value).success).toBe(false);
    },
  );

  it('trims and lowercases before validating', () => {
    expect(usernameSchema.parse(' Archan ')).toBe('archan');
    expect(usernameSchema.parse('UPPER')).toBe('upper');
  });

  it('rejects a name that is too short only after trimming', () => {
    expect(usernameSchema.safeParse('  ab  ').success).toBe(false);
  });

  it('gives a message on failure', () => {
    const result = usernameSchema.safeParse('ab');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message.length).toBeGreaterThan(0);
  });
});

describe('displayNameSchema', () => {
  it.each(['', '   '])('rejects %j', (value) => {
    expect(displayNameSchema.safeParse(value).success).toBe(false);
  });

  it('accepts 1 and 50 characters, rejects 51', () => {
    expect(displayNameSchema.safeParse('a').success).toBe(true);
    expect(displayNameSchema.safeParse('a'.repeat(50)).success).toBe(true);
    expect(displayNameSchema.safeParse('a'.repeat(51)).success).toBe(false);
  });

  it('trims', () => {
    expect(displayNameSchema.parse('  Archan Me ')).toBe('Archan Me');
  });
});

describe('bioSchema', () => {
  it('accepts empty and 160, rejects 161', () => {
    expect(bioSchema.safeParse('').success).toBe(true);
    expect(bioSchema.safeParse('b'.repeat(160)).success).toBe(true);
    expect(bioSchema.safeParse('b'.repeat(161)).success).toBe(false);
  });
});

describe('citySchema', () => {
  it('accepts empty and 60, rejects 61', () => {
    expect(citySchema.safeParse('').success).toBe(true);
    expect(citySchema.safeParse('c'.repeat(60)).success).toBe(true);
    expect(citySchema.safeParse('c'.repeat(61)).success).toBe(false);
  });

  it('is free text', () => {
    expect(citySchema.safeParse('São Paulo, BR 🌍').success).toBe(true);
  });
});

describe('setupProfileSchema', () => {
  it('parses and normalises display_name and username', () => {
    expect(setupProfileSchema.parse({ display_name: '  Archan ', username: ' Archan_1 ' })).toEqual(
      { display_name: 'Archan', username: 'archan_1' },
    );
  });

  it('rejects missing or invalid fields', () => {
    expect(setupProfileSchema.safeParse({ display_name: '', username: 'archan' }).success).toBe(
      false,
    );
    expect(setupProfileSchema.safeParse({ display_name: 'A', username: 'ab' }).success).toBe(false);
    expect(setupProfileSchema.safeParse({ display_name: 'A' }).success).toBe(false);
  });
});

describe('editProfileSchema', () => {
  const valid = { display_name: 'Archan', username: 'archan', bio: 'hi', city: 'Paris' };

  it('accepts a valid profile and empty bio/city', () => {
    expect(editProfileSchema.safeParse(valid).success).toBe(true);
    expect(editProfileSchema.safeParse({ ...valid, bio: '', city: '' }).success).toBe(true);
  });

  it('rejects over-long bio and city and bad username', () => {
    expect(editProfileSchema.safeParse({ ...valid, bio: 'b'.repeat(161) }).success).toBe(false);
    expect(editProfileSchema.safeParse({ ...valid, city: 'c'.repeat(61) }).success).toBe(false);
    expect(editProfileSchema.safeParse({ ...valid, username: 'has space' }).success).toBe(false);
  });

  it('lowercases the username', () => {
    expect(editProfileSchema.parse({ ...valid, username: 'Archan' }).username).toBe('archan');
  });
});
