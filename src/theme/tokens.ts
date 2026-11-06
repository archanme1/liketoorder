export const colors = {
  bg: '#FFFDF9',
  surface: '#FFFFFF',
  surfaceAlt: '#F6F1EA',
  text: '#1F1A17',
  textMuted: '#6B625B',
  border: '#E8E0D6',
  primary: '#CF471C', // warm paprika; ≥ 4.5:1 with primaryText and bg (WCAG AA)
  primaryText: '#FFFFFF',
  success: '#2E7D4F',
  warning: '#B7791F',
  danger: '#C0392B',
  info: '#2B6CB0',
  grid0: '#EFE8DF', // activity intensity
  grid1: '#F9C9A8',
  grid2: '#F08A55',
  grid3: '#C2410C',
  adRing: '#F4B400',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 };

export const type = { caption: 12, body: 15, bodyLg: 17, title: 20, h1: 28 };

export const weight = { regular: '400', semibold: '600', bold: '700' } as const;

// Minimum touch target (accessibility rule: ≥ 44pt), avatar diameters, tab bar icons, photo
// thumbnails and map marker sizes.
export const size = {
  touch: 44,
  avatarSm: 40,
  avatarMd: 64,
  avatarLg: 96,
  tabIcon: 24,
  photoThumb: 96,
  // Map markers (spec 07): flag pill, and cluster circles that grow with the count.
  flagWidth: 32,
  flagHeight: 24,
  clusterSm: 36,
  clusterMd: 42,
  clusterLg: 48,
};

// Pressable feedback and inactive (disabled / loading) controls.
export const opacity = { disabled: 0.5, pressed: 0.8 };

// Border widths: a selected option gets a thicker border as well as a check icon.
export const stroke = { selected: 2 };

export const theme = { colors, space, radius, type, weight, size, opacity, stroke };

export type Theme = typeof theme;
