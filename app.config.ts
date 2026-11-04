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
