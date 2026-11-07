// Fictional demo restaurants for the LOCAL database. Names, addresses and menus are invented;
// coordinates are real places in Ontario so the map has somewhere sensible to show them.

export type Area = { key: string; city: string; lat: number; lng: number; spread: number };

export const AREAS: Record<string, Area> = {
  oshawa: { key: 'oshawa', city: 'Oshawa', lat: 43.8971, lng: -78.8658, spread: 0.035 },
  cambridge: { key: 'cambridge', city: 'Cambridge', lat: 43.3616, lng: -80.3144, spread: 0.03 },
  // A tight group so zooming out clusters it.
  toronto: { key: 'toronto', city: 'Toronto', lat: 43.6532, lng: -79.3832, spread: 0.012 },
};

export type Seed = {
  name: string;
  cuisine: string;
  /** A named area (jittered around its centre) or an exact point (a GTA town). */
  where: { area: string } | { city: string; lat: number; lng: number };
  menu?: boolean;
};

const o = { area: 'oshawa' } as const;
const c = { area: 'cambridge' } as const;
const t = { area: 'toronto' } as const;

export const RESTAURANTS: Seed[] = [
  // Oshawa (14)
  { name: 'Lakeview Trattoria', cuisine: 'IT', where: o, menu: true },
  { name: 'Simcoe Street Pho', cuisine: 'VN', where: o },
  { name: 'Golden Tandoor', cuisine: 'IN', where: o, menu: true },
  { name: 'Oshawa Jerk Hut', cuisine: 'JM', where: o },
  { name: 'Maple Taqueria', cuisine: 'MX', where: o },
  { name: 'Kingsway Souvlaki', cuisine: 'GR', where: o },
  { name: 'Tokyo Bento Bar', cuisine: 'JP', where: o },
  { name: 'Bangkok Garden', cuisine: 'TH', where: o },
  { name: 'Harbour Fish & Chips', cuisine: 'GB', where: o },
  { name: 'Seoul Kitchen', cuisine: 'KR', where: o, menu: true },
  { name: 'Casa Lisboa', cuisine: 'PT', where: o },
  { name: 'Beirut Bites', cuisine: 'LB', where: o },
  { name: 'Ontario Smokehouse', cuisine: 'US', where: o },
  { name: 'Street Eats Truck', cuisine: 'street-food', where: o },
  // Cambridge (10)
  { name: 'Galt Gelateria & Grill', cuisine: 'IT', where: c },
  { name: 'Dundas Dumplings', cuisine: 'CN', where: c, menu: true },
  { name: 'Spice Route', cuisine: 'IN', where: c },
  { name: 'Le Petit Galt', cuisine: 'FR', where: c },
  { name: 'El Camino Cantina', cuisine: 'MX', where: c },
  { name: 'Hespeler Hellenic', cuisine: 'GR', where: c },
  { name: 'Grand River Ramen', cuisine: 'JP', where: c },
  { name: 'Addis Table', cuisine: 'ET', where: c },
  { name: 'Fusion 401', cuisine: 'fusion', where: c },
  { name: 'Mill Race Kitchen', cuisine: 'other', where: c },
  // Downtown Toronto (10), close together so they cluster
  { name: 'King West Brasserie', cuisine: 'FR', where: t, menu: true },
  { name: 'Queen Street Sushi', cuisine: 'JP', where: t },
  { name: 'Kensington Empanadas', cuisine: 'PE', where: t },
  { name: 'Chinatown Noodle House', cuisine: 'CN', where: t },
  { name: 'Little Italy Pizzeria', cuisine: 'IT', where: t },
  { name: 'Greektown Grill', cuisine: 'GR', where: t },
  { name: 'Little India Dosa', cuisine: 'IN', where: t },
  { name: 'Roncy Pierogi', cuisine: 'PL', where: t },
  { name: 'Bloor Bibimbap', cuisine: 'KR', where: t },
  { name: 'Distillery Tapas', cuisine: 'ES', where: t },
  // The rest of the Greater Toronto Area (14)
  {
    name: 'Credit River Curry',
    cuisine: 'IN',
    where: { city: 'Mississauga', lat: 43.589, lng: -79.6441 },
  },
  {
    name: 'Unionville Dim Sum',
    cuisine: 'CN',
    where: { city: 'Markham', lat: 43.8561, lng: -79.337 },
  },
  { name: 'Markham Pho 99', cuisine: 'VN', where: { city: 'Markham', lat: 43.866, lng: -79.3 } },
  {
    name: 'Gore Road Biryani',
    cuisine: 'PK',
    where: { city: 'Brampton', lat: 43.7315, lng: -79.7624 },
  },
  {
    name: 'Kennedy Kebab House',
    cuisine: 'TR',
    where: { city: 'Scarborough', lat: 43.7279, lng: -79.2636 },
  },
  {
    name: 'Scarborough Pinoy Grill',
    cuisine: 'PH',
    where: { city: 'Scarborough', lat: 43.7764, lng: -79.2318 },
  },
  {
    name: 'Humber Bay Schnitzel',
    cuisine: 'DE',
    where: { city: 'Etobicoke', lat: 43.6205, lng: -79.5132 },
  },
  {
    name: 'Woodbridge Trattoria',
    cuisine: 'IT',
    where: { city: 'Vaughan', lat: 43.8361, lng: -79.5083 },
  },
  {
    name: "Frenchman's Bay Fish",
    cuisine: 'GB',
    where: { city: 'Pickering', lat: 43.8384, lng: -79.0868 },
  },
  { name: 'Ajax Arepas', cuisine: 'VE', where: { city: 'Ajax', lat: 43.8509, lng: -79.0204 } },
  {
    name: 'Whitby Brunch House',
    cuisine: 'US',
    where: { city: 'Whitby', lat: 43.8975, lng: -78.9429 },
  },
  {
    name: 'Burlington Bistro',
    cuisine: 'FR',
    where: { city: 'Burlington', lat: 43.3255, lng: -79.799 },
  },
  {
    name: 'Oakville Olive',
    cuisine: 'GR',
    where: { city: 'Oakville', lat: 43.4675, lng: -79.6877 },
  },
  {
    name: 'North York Shawarma',
    cuisine: 'LB',
    where: { city: 'North York', lat: 43.7615, lng: -79.4111 },
  },
];

/** Rows that must NOT appear on the map. Each is proof that a rule works. */
export type HiddenKind = 'stale' | 'not_found' | 'unlisted';
export const HIDDEN: {
  kind: HiddenKind;
  name: string;
  cuisine: string;
  type: 'restaurant' | 'homemade';
}[] = [
  { kind: 'stale', name: 'Hidden Stale Diner (31 days old)', cuisine: 'US', type: 'restaurant' },
  { kind: 'not_found', name: 'Hidden NotFound Cafe', cuisine: 'FR', type: 'restaurant' },
  { kind: 'unlisted', name: 'Hidden Unlisted Bistro', cuisine: 'IT', type: 'restaurant' },
];

export type MenuLine = {
  name: string;
  description?: string;
  price_minor: number | null;
  available?: boolean;
};

// Prices in Canadian cents. One item has no price and one is sold out, so the sheet shows both.
export const MENUS: Record<string, MenuLine[]> = {
  'Lakeview Trattoria': [
    {
      name: 'Margherita pizza',
      description: 'San Marzano tomato, fior di latte, basil.',
      price_minor: 1695,
    },
    { name: 'Spaghetti carbonara', price_minor: 1895 },
    {
      name: 'Lasagna al forno',
      description: 'Layers of beef ragù and béchamel.',
      price_minor: 2095,
    },
    { name: 'Tiramisu', price_minor: 995, available: false },
    { name: 'House salad', price_minor: 895 },
  ],
  'Golden Tandoor': [
    {
      name: 'Butter chicken',
      description: 'Creamy tomato sauce, basmati rice.',
      price_minor: 1995,
    },
    { name: 'Lamb rogan josh', price_minor: 2295 },
    { name: 'Palak paneer', price_minor: 1795 },
    { name: 'Garlic naan', price_minor: 395 },
    { name: 'Mango lassi', price_minor: 595 },
    { name: "Chef's thali", description: 'Ask what is on today.', price_minor: null },
  ],
  'Seoul Kitchen': [
    { name: 'Bibimbap', description: 'Rice, vegetables, egg and gochujang.', price_minor: 1695 },
    { name: 'Kimchi jjigae', price_minor: 1595 },
    { name: 'Korean fried chicken', price_minor: 1895 },
    { name: 'Japchae', price_minor: 1495 },
  ],
  'Dundas Dumplings': [
    { name: 'Pork and chive dumplings (12)', price_minor: 1295 },
    { name: 'Xiao long bao (6)', price_minor: 1195 },
    { name: 'Hot and sour soup', price_minor: 795 },
    { name: 'Scallion pancake', price_minor: 695 },
    {
      name: 'Dan dan noodles',
      description: 'Spicy sesame sauce, minced pork.',
      price_minor: 1395,
      available: false,
    },
  ],
  'King West Brasserie': [
    { name: 'Steak frites', price_minor: 3295 },
    { name: 'French onion soup', price_minor: 1395 },
    { name: 'Duck confit', description: 'Crisp skin, lentils du Puy.', price_minor: 3495 },
    { name: 'Crème brûlée', price_minor: 1195 },
    { name: 'Croque monsieur', price_minor: 1895 },
    { name: 'Niçoise salad', price_minor: 2095 },
    { name: 'Moules marinières', price_minor: 2495 },
  ],
};

export const STREETS = [
  'King St',
  'Queen St',
  'Main St',
  'Church St',
  'Bay St',
  'Elm Ave',
  'Park Rd',
  'Mill St',
];
