type EnvModule = typeof import('@/lib/env');

const URL_KEY = 'EXPO_PUBLIC_SUPABASE_URL';
const ANON_KEY = 'EXPO_PUBLIC_SUPABASE_ANON_KEY';

const originalValues = { [URL_KEY]: process.env[URL_KEY], [ANON_KEY]: process.env[ANON_KEY] };

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

// Loads env.ts fresh so its module-level validation runs against the current process.env.
function loadEnvModule(): EnvModule {
  let loaded: EnvModule | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require('@/lib/env');
  });
  if (!loaded) throw new Error('env module did not load');
  return loaded;
}

describe('env', () => {
  // Restore in place: replacing `process.env` with a copy makes later deletes unreliable under jest.
  afterEach(() => {
    setEnv(originalValues);
  });

  it('returns both values when present', () => {
    setEnv({ [URL_KEY]: 'http://127.0.0.1:54321', [ANON_KEY]: 'anon-key-123' });
    const { env } = loadEnvModule();
    expect(env.EXPO_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:54321');
    expect(env.EXPO_PUBLIC_SUPABASE_ANON_KEY).toBe('anon-key-123');
  });

  it('throws an error naming EXPO_PUBLIC_SUPABASE_URL when it is missing', () => {
    setEnv({ [URL_KEY]: undefined, [ANON_KEY]: 'anon-key-123' });
    expect(() => loadEnvModule()).toThrow(/EXPO_PUBLIC_SUPABASE_URL/);
  });

  it('throws an error naming EXPO_PUBLIC_SUPABASE_ANON_KEY when it is missing', () => {
    setEnv({ [URL_KEY]: 'http://127.0.0.1:54321', [ANON_KEY]: undefined });
    expect(() => loadEnvModule()).toThrow(/EXPO_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it('throws naming EXPO_PUBLIC_SUPABASE_URL when it is empty', () => {
    setEnv({ [URL_KEY]: '', [ANON_KEY]: 'anon-key-123' });
    expect(() => loadEnvModule()).toThrow(/EXPO_PUBLIC_SUPABASE_URL/);
  });

  it('throws naming EXPO_PUBLIC_SUPABASE_ANON_KEY when it is empty', () => {
    setEnv({ [URL_KEY]: 'http://127.0.0.1:54321', [ANON_KEY]: '' });
    expect(() => loadEnvModule()).toThrow(/EXPO_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it('throws naming EXPO_PUBLIC_SUPABASE_URL when it is not a URL', () => {
    setEnv({ [URL_KEY]: 'not-a-url', [ANON_KEY]: 'anon-key-123' });
    expect(() => loadEnvModule()).toThrow(/EXPO_PUBLIC_SUPABASE_URL/);
  });
});
