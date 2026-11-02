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
  plugins: ['expo-router'],
};

export default config;
