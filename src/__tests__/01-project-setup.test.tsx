// The spec 01 placeholder-home tests were removed in spec 02, which replaces that screen.

describe('root layout startup (spec 01)', () => {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  // Restore the keys in place: after `process.env` is replaced with a copy,
  // `delete process.env.X` no longer removes the var under jest.
  afterEach(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = url;
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = anonKey;
  });

  function loadRootLayout(): void {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../app/_layout');
    });
  }

  it('loads when the Supabase env vars are set', () => {
    expect(loadRootLayout).not.toThrow();
  });

  it('fails at startup with a clear error when EXPO_PUBLIC_SUPABASE_URL is missing', () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    expect(loadRootLayout).toThrow(/EXPO_PUBLIC_SUPABASE_URL/);
  });

  it('fails at startup with a clear error when EXPO_PUBLIC_SUPABASE_ANON_KEY is missing', () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    expect(loadRootLayout).toThrow(/EXPO_PUBLIC_SUPABASE_ANON_KEY/);
  });
});
