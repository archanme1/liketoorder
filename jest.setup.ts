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
// The deep path is the same JSON the real Ionicons component imports; update it if an
// @expo/vector-icons upgrade moves that file.
jest.mock('@expo/vector-icons/Ionicons', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { createElement } = require('react');
  const { View } = require('react-native');
  const glyphMap = require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const Ionicons = Object.assign((props: object) => createElement(View, props), { glyphMap });
  return { __esModule: true, default: Ionicons };
});

// ── Spec 06 media modules: native under jest, so each gets a small controllable fake. ──
// Tests override behaviour with jest.mocked(...).mockImplementation / jest.spyOn.

// Default: the user cancels. Tests resolve { canceled: false, assets: [{ uri, width, height }] }.
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));

// A chainable fake of the contextual API: manipulate(uri) → context; context.resize(size) records
// the size and returns the context; context.renderAsync() → an image ref of 1200 × 900 (override
// renderAsync to change it) whose saveAsync(options) → { uri, width, height }.
jest.mock('expo-image-manipulator', () => {
  function makeImageRef(width: number, height: number) {
    return {
      width,
      height,
      saveAsync: jest.fn(async () => ({ uri: 'file:///mock/manipulated.jpg', width, height })),
      release: jest.fn(),
    };
  }
  type MockContext = {
    resize: jest.Mock<MockContext, [object]>;
    renderAsync: jest.Mock<Promise<ReturnType<typeof makeImageRef>>, []>;
    reset: jest.Mock<MockContext, []>;
  };
  function makeContext(): MockContext {
    const context: MockContext = {
      resize: jest.fn((_size: object): MockContext => context),
      renderAsync: jest.fn(async () => makeImageRef(1200, 900)),
      reset: jest.fn((): MockContext => context),
    };
    return context;
  }
  return {
    ImageManipulator: { manipulate: jest.fn(() => makeContext()) },
    SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
    __makeImageRef: makeImageRef,
  };
});

// File#bytes() is a prototype method, so tests can jest.spyOn(File.prototype, 'bytes') and read
// `this.uri`. Default: the smallest JPEG the strip + metadata check accept (SOI, DQT, SOS, one
// byte of image data, EOI).
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    async bytes(): Promise<Uint8Array> {
      return new Uint8Array([
        0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xda, 0x00, 0x02, 0x00, 0xff, 0xd9,
      ]);
    }
  }
  return { File };
});

// Default device: US English, US dollars. Tests override getLocales for other locales/currencies.
jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [
    {
      languageTag: 'en-US',
      languageCode: 'en',
      regionCode: 'US',
      currencyCode: 'USD',
      currencySymbol: '$',
      decimalSeparator: '.',
      digitGroupingSeparator: ',',
      textDirection: 'ltr',
      measurementSystem: 'us',
      temperatureUnit: 'fahrenheit',
    },
  ]),
  getCalendars: jest.fn(() => [{ calendar: 'gregory', timeZone: 'UTC', uses24hourClock: false }]),
}));

// expo-image renders a plain View that keeps every prop (source incl. cacheKey, cachePolicy,
// onLoad, onError), so tests can inspect them and call the handlers directly.
jest.mock('expo-image', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { createElement } = require('react');
  const { View } = require('react-native');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const Image = (props: object) => createElement(View, { testID: 'expo-image', ...props });
  return { Image };
});

// ── Spec 07 map modules: native under jest, so each gets a small controllable fake. ──

// MapView renders a plain View (testID "map-view") that keeps every prop, so tests can read
// provider / initialRegion and call onRegionChangeComplete. The ref exposes animateToRegion, which
// is the shared jest.fn `__animateToRegion` so tests can assert the camera moved (or didn't).
jest.mock('react-native-maps', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const React = require('react');
  const { View } = require('react-native');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const animateToRegion = jest.fn();
  const MapView = React.forwardRef(function MockMapView(props: object, ref: unknown) {
    React.useImperativeHandle(ref, () => ({ animateToRegion }));
    return React.createElement(View, { testID: 'map-view', ...props });
  });
  // Markers render their children in a View that keeps every prop (coordinate, onPress,
  // tracksViewChanges, accessibility*), so tests can find and press them.
  const Marker = function MockMarker(props: object) {
    return React.createElement(View, { testID: 'marker', ...props });
  };
  return {
    __esModule: true,
    default: MapView,
    Marker,
    PROVIDER_GOOGLE: 'google',
    __animateToRegion: animateToRegion,
  };
});

// Foreground location only. Default: services on, never asked, and a fix near Paris. Tests
// override with jest.mocked(Location.x).mockResolvedValue(...).
jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  Accuracy: { Balanced: 3 },
  hasServicesEnabledAsync: jest.fn(async () => true),
  getForegroundPermissionsAsync: jest.fn(async () => ({
    status: 'undetermined',
    canAskAgain: true,
    granted: false,
  })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({
    status: 'granted',
    canAskAgain: true,
    granted: true,
  })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: 48.8566, longitude: 2.3522 },
  })),
}));
