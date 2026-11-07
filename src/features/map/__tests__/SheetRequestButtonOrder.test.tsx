import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { signedUrls } from '@/features/media/api';
import { getCurrencies } from '@/features/menu/api';
import { AuthContext, type AuthContextValue } from '@/features/auth/components/AuthProvider';

import { fetchHomemadeDetails, fetchRestaurantDetails } from '../api';
import { HomemadeSheetDetails } from '../components/HomemadeSheetDetails';
import { SheetDetails } from '../components/SheetDetails';
import { HOMEMADE_AREA_NOTE } from '../homemadeText';
import type { DetailsItem, DetailsPhoto } from '../schema';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('@/features/menu/api', () => ({
  ...jest.requireActual('@/features/menu/api'),
  getCurrencies: jest.fn(),
}));
jest.mock('@/features/media/api', () => ({
  ...jest.requireActual('@/features/media/api'),
  signedUrls: jest.fn(),
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  fetchRestaurantDetails: jest.fn(),
  fetchHomemadeDetails: jest.fn(),
}));

const photos: DetailsPhoto[] = [
  { id: 'p1', kind: 'cover', path: 'b1/cover.jpg', position: null, menu_item_id: null },
  { id: 'p2', kind: 'gallery', path: 'b1/g1.jpg', position: 1, menu_item_id: null },
  { id: 'p4', kind: 'menu', path: 'b1/m1.jpg', position: 1, menu_item_id: null },
];
const items: DetailsItem[] = [
  {
    id: 'i1',
    name: 'Pasta',
    description: null,
    price_minor: 1200,
    is_available: true,
    position: 1,
  },
];

const guest: AuthContextValue = {
  session: null,
  isLoading: false,
  isRecovering: false,
  notice: null,
  prepareRecovery: jest.fn(),
  abandonRecovery: jest.fn(),
  markRecovering: jest.fn(),
  clearRecovering: jest.fn(),
  dismissNotice: jest.fn(),
};

let client: QueryClient;
function wrap(ui: ReactNode) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return (
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={guest}>{ui}</AuthContext.Provider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.mocked(getCurrencies).mockResolvedValue([]);
  jest
    .mocked(signedUrls)
    .mockImplementation(async (_bucket, paths) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed.test/${p}`])),
    );
  jest.mocked(fetchRestaurantDetails).mockResolvedValue({
    id: 'b1',
    name: 'Rosa',
    cuisine_code: 'IT',
    accepts_table_requests: false,
    public_address: '1 King St',
    place_id: 'FAKE',
    currency_code: 'CAD',
    photos,
    items,
  });
  jest.mocked(fetchHomemadeDetails).mockResolvedValue({
    id: 'b1',
    name: 'Rosa',
    cuisine_code: 'IT',
    currency_code: 'CAD',
    photos,
    items,
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

function at(needle: string): number {
  return JSON.stringify(screen.toJSON()).indexOf(needle);
}
const MENU_PAGES = '"testID":"menu-pages"';
const FIRST_ITEM = '"Pasta"';
const BUTTON = '"accessibilityLabel":"Request pickup from Rosa"';
const GALLERY = '"testID":"gallery-strip"';

describe('the Request pickup button sits right after the menu items and before the gallery', () => {
  it.each([
    ['restaurant', <SheetDetails key="r" id="b1" onClose={jest.fn()} />, '"Address"'],
    ['homemade', <HomemadeSheetDetails key="h" id="b1" onClose={jest.fn()} />, HOMEMADE_AREA_NOTE],
  ])('%s sheet', async (_name, ui, bottom) => {
    await render(wrap(ui));
    await screen.findByText('Menu');
    await screen.findByRole('button', { name: 'Request pickup from Rosa' });

    const order = [MENU_PAGES, FIRST_ITEM, BUTTON, GALLERY, bottom].map(at);
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
