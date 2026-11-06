import { assertLocalUrl, isSeedEmail } from '../safety';

describe('assertLocalUrl', () => {
  it.each(['http://127.0.0.1:54321', 'http://localhost:54321', 'http://127.0.0.1:54321/'])(
    'allows %s',
    (url) => {
      expect(() => assertLocalUrl(url)).not.toThrow();
    },
  );

  it('returns the origin without a trailing slash', () => {
    expect(assertLocalUrl('http://127.0.0.1:54321/')).toBe('http://127.0.0.1:54321');
  });

  it.each([
    'https://abcd.supabase.co',
    'https://127.0.0.1:54321',
    'http://192.168.1.20:54321',
    'http://0.0.0.0:54321',
    'http://localhost.evil.com',
    'http://127.0.0.1.nip.io:54321',
    'http://evil.com/127.0.0.1',
    'http://user:pass@127.0.0.1:54321',
    'http://[::1]:54321',
    'not a url',
    '',
  ])('refuses %p', (url) => {
    expect(() => assertLocalUrl(url)).toThrow(/Refusing to run/);
  });
});

describe('isSeedEmail', () => {
  it.each(['seed-restaurant-001@example.com', 'seed-hidden-stale@example.com'])(
    'accepts %s',
    (email) => {
      expect(isSeedEmail(email)).toBe(true);
    },
  );

  it.each([
    'archan@gmail.com',
    'someone@example.com',
    'seed-restaurant-001@example.org',
    'seed-restaurant-001@example.com.evil.com',
    'xseed-restaurant-001@example.com',
    'seed-@example.com',
    '',
    null,
    undefined,
  ])('rejects %p', (email) => {
    expect(isSeedEmail(email)).toBe(false);
  });
});
