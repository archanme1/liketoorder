// Fixed local-looking values so tests never depend on a .env file (CI has none).
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

// AsyncStorage has no native module under jest; use the package's official mock.
// jest.mock factories are hoisted above imports, so they must use require().
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// The icon font is a bundled asset that jest's asset registry can't load; render a plain View
// that keeps the props (name, accessibility) so tests can still inspect the icon.
// glyphMap is the installed package's real name → codepoint map, so name checks match the app.
jest.mock('@expo/vector-icons/Ionicons', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { createElement } = require('react');
  const { View } = require('react-native');
  const glyphMap = require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const Ionicons = Object.assign((props: object) => createElement(View, props), { glyphMap });
  return { __esModule: true, default: Ionicons };
});
