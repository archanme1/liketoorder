// Fictional demo home cooks for the LOCAL database. Names, menus and addresses are invented;
// coordinates are real places in Ontario so the map has somewhere sensible to show them. The map
// point is NOT set here: each cook goes through the real set_business_location function, which
// applies the 200–500 m shift, so what the map shows is exactly what the server would produce.
import type { MenuLine } from './restaurantData';

/**
 * Photos for a cook, by file name (without .jpg) in scripts/seed/photos/. The files are plain-colour,
 * fictional, EXIF-free JPEGs under 100 KB, so no licence or privacy question arises.
 */
export type HomemadePhotos = {
  cover?: string;
  gallery?: string[];
  menu?: string[];
  /** The photo ROW exists but its file is never uploaded: the "Photo unavailable" case. */
  fileMissing?: boolean;
};

export type HomemadeSeed = {
  name: string;
  cuisine: string;
  area: 'oshawa' | 'cambridge' | 'toronto';
  menu?: MenuLine[];
  photos?: HomemadePhotos;
};

// Visible cooks (13): Oshawa 5, Cambridge 3 and a tight Toronto group of 5 that clusters when
// zoomed out and whose circles overlap when zoomed in.
export const HOMEMADE_COOKS: HomemadeSeed[] = [
  {
    name: "Nonna Rosa's Table",
    cuisine: 'IT',
    area: 'oshawa',
    // Cover, three gallery photos, two menu pages and a menu: the full sheet.
    photos: {
      cover: 'rosa-cover',
      gallery: ['rosa-gallery-1', 'rosa-gallery-2', 'rosa-gallery-3'],
      menu: ['rosa-menu-1', 'rosa-menu-2'],
    },
    menu: [
      {
        name: 'Handmade tagliatelle',
        description: 'Slow ragù, parmigiano.',
        price_minor: 1800,
      },
      { name: 'Eggplant parmigiana', price_minor: 1600 },
      { name: 'Ricotta cannoli (3)', price_minor: 900, available: false },
      { name: "Nonna's lemon cake", description: 'Ask what is baked today.', price_minor: null },
    ],
  },
  // Items only, no photos at all.
  {
    name: "Amara's Jollof Kitchen",
    cuisine: 'NG',
    area: 'oshawa',
    menu: [
      { name: 'Party jollof rice', description: 'Smoky tomato rice.', price_minor: 1400 },
      { name: 'Fried plantain', price_minor: 600 },
      { name: 'Suya skewers (4)', price_minor: 1300, available: false },
    ],
  },
  // Menu photos only.
  {
    name: 'Curry Leaf Home Cooking',
    cuisine: 'IN',
    area: 'oshawa',
    photos: { menu: ['plain-1'] },
  },
  // Cover only.
  { name: 'Abuela Marta Empanadas', cuisine: 'AR', area: 'oshawa', photos: { cover: 'plain-2' } },
  // The photo row exists but its file is missing ("Photo unavailable").
  {
    name: 'Little Seoul Banchan',
    cuisine: 'KR',
    area: 'oshawa',
    photos: { cover: 'plain-1', fileMissing: true },
  },
  { name: 'Grand River Pierogi', cuisine: 'PL', area: 'cambridge' },
  { name: "Mama Lina's Injera", cuisine: 'ET', area: 'cambridge' },
  { name: 'Tamarind & Rice Home Kitchen', cuisine: 'LK', area: 'cambridge' },
  { name: 'Danforth Dolma House', cuisine: 'GR', area: 'toronto' },
  { name: 'Kensington Arepas', cuisine: 'VE', area: 'toronto' },
  { name: 'Queen West Bao Studio', cuisine: 'CN', area: 'toronto' },
  { name: 'Parkdale Pelmeni', cuisine: 'UA', area: 'toronto' },
  { name: 'Annex Tamales', cuisine: 'MX', area: 'toronto' },
];

/** Cooks that must NOT appear on the map. Each is proof that a rule works. */
export type HomemadeHiddenKind = 'stale' | 'not_found' | 'unlisted';
export const HOMEMADE_HIDDEN: {
  kind: HomemadeHiddenKind;
  name: string;
  cuisine: string;
  /** The account name part: seed-homemade-<key>@example.com */
  key: string;
}[] = [
  { kind: 'stale', name: 'Stale Samosas', cuisine: 'IN', key: 'stale' },
  { kind: 'not_found', name: 'Gone Place', cuisine: 'FR', key: 'gone' },
  { kind: 'unlisted', name: 'Unlisted Kitchen', cuisine: 'JP', key: 'unlisted' },
];
