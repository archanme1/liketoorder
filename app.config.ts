import type { ExpoConfig } from 'expo/config';

import { colors } from './src/theme/tokens.ts';

const config: ExpoConfig = {
  name: 'LikeToOrder',
  slug: 'liketoorder',
  scheme: 'liketoorder',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'com.archanme1.liketoorder',
    supportsTablet: true,
  },
  android: {
    package: 'com.archanme1.liketoorder',
    adaptiveIcon: {
      backgroundColor: colors.bg,
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
  },
  plugins: [
    'expo-router',
    'expo-image',
    'expo-localization',
    'expo-dev-client',
    [
      // Google Maps SDK on both platforms (Places content must be shown on a Google map).
      // Keys are public EXPO_PUBLIC_* values; with no iOS key the plugin links no Google pod,
      // and the map screen shows "Map isn't configured" instead of rendering a map.
      'react-native-maps',
      {
        iosGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY,
        androidGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY,
      },
    ],
    [
      // Foreground only: no background modes, no "always" strings.
      'expo-location',
      {
        locationWhenInUsePermission:
          "LikeToOrder uses your location while you have the app open, only to show restaurants near you on the map. Your exact location stays on your phone. We only receive the map area you're looking at.",
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'LikeToOrder uses your photos to add pictures to your menu and listing.',
        // Library only (spec 06): no camera or microphone permission strings.
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
  ],
};

export default config;
