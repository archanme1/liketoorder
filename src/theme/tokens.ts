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
  // A thin outline on empty activity squares, so their shape shows against the page (spec 14
  // Decision 2): grid0 on bg alone is very low contrast.
  gridOutline: '#D9CFC3',
  adRing: '#F4B400',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

// grid: the activity grid's small squares (spec 14 Decision 11).
export const radius = { sm: 6, md: 10, lg: 16, pill: 999, grid: 3 };

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
  // The day panel's row thumbnail (spec 14).
  photoMini: 48,
  photoLarge: 160,
  // The short cover banner at the top of the map sheet (spec 08 Decision 15).
  coverBanner: 88,
  // Map markers (spec 07): flag pill, and cluster circles that grow with the count.
  flagWidth: 32,
  flagHeight: 24,
  clusterSm: 36,
  clusterMd: 42,
  clusterLg: 48,
  // Promoted (ad) markers (spec 16): the larger pill, about 1.3 times the flag pill, and the
  // marker's box, which leaves room for the ad ring, the "Ad" badge and the 4 pt float without
  // clipping (a marker is drawn as a picture of exactly this box). Also above the 44 pt target.
  promotedFlagWidth: 42,
  promotedFlagHeight: 31,
  promotedMarker: 64,
  // Activity grid squares and the gap between them (spec 14 Decision 11). The squares are the one
  // documented exception to the 44 pt touch rule: every action they offer is also reachable
  // through 44 pt controls (the list view, Previous / Next day, the day panel rows).
  gridCell: 14,
  gridGap: 3,
  // The Cuisine view's flag, icon or globe inside a grid square (spec 15 Decision 3), drawn
  // without font scaling so it always fits the 14 pt square.
  gridGlyph: 10,
};

// Pressable feedback and inactive (disabled / loading) controls.
export const opacity = { disabled: 0.5, pressed: 0.8 };

// How far titles and labels may grow with the system text size (accessibility font scale), so
// they wrap and stay whole instead of being cut. Body text is not capped.
export const maxFontMultiplier = 1.6;

// Border widths: a selected option gets a thicker border as well as a check icon. today: the
// activity grid marks today with a thinner dark outline than the selected day (spec 14).
// adRing: the ring around a promoted map marker (spec 16), drawn in colors.adRing.
export const stroke = { selected: 2, today: 1, adRing: 2 };

// The homemade "somewhere in this area" circle (spec 08): the primary colour, translucent fill with
// a firmer outline so the edge still reads without relying on the fill alone.
function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
export const mapArea = {
  fill: withAlpha(colors.primary, 0.15),
  stroke: withAlpha(colors.primary, 0.7),
  strokeWidth: 2,
};

// The full-screen photo viewer: a dark backdrop with light text and controls on top of it.
export const viewer = {
  backdrop: 'rgba(0, 0, 0, 0.94)',
  text: '#FFFFFF',
  control: 'rgba(255, 255, 255, 0.16)',
};

// The dim layer behind a modal dialog (the pickup time picker): the page stays visible but muted.
export const scrim = 'rgba(0, 0, 0, 0.4)';

export const theme = {
  colors,
  space,
  radius,
  type,
  weight,
  size,
  opacity,
  stroke,
  mapArea,
  viewer,
  scrim,
};

export type Theme = typeof theme;
