import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import HomeScreen from '../../app/index';

const initialMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function renderHome() {
  return render(
    <SafeAreaProvider initialMetrics={initialMetrics}>
      <HomeScreen />
    </SafeAreaProvider>,
  );
}

describe('placeholder home screen (spec 01)', () => {
  it('renders the LikeToOrder title', async () => {
    await renderHome();
    expect(screen.getByText('LikeToOrder')).toBeTruthy();
  });

  it('exposes the demo button with role button and an accessibility label', async () => {
    await renderHome();
    // Found by role, so the role is proven; the label must be real text, not empty.
    expect(screen.getByRole('button').props.accessibilityLabel).toMatch(/\S/);
  });
});

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
