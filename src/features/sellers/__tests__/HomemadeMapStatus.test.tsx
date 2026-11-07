import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';

import { AuthProvider } from '@/features/auth/components/AuthProvider';
import { listCuisines } from '@/features/cuisines/api';
import { getMenu } from '@/features/menu/api';
import * as profileApi from '@/features/profile/api';
import { supabase } from '@/lib/supabase';

import { getMyBusiness } from '../api';
import {
  HOMEMADE_MAP_STATUS_MESSAGE,
  MAP_STATUS_MESSAGE,
  MapStatusLine,
} from '../components/MapStatusLine';
import { ManageBusinessScreen } from '../components/ManageBusinessScreen';
import type { MyBusiness } from '../schema';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  setParams: jest.fn(),
  canGoBack: jest.fn(() => true),
};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Redirect: () => null,
  useLocalSearchParams: () => ({}),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: jest.fn(), getSession: jest.fn() } },
}));
jest.mock('@/features/profile/api', () => ({
  ...jest.requireActual('@/features/profile/api'),
  getMyProfile: jest.fn(),
}));
jest.mock('@/features/cuisines/api', () => ({
  ...jest.requireActual('@/features/cuisines/api'),
  listCuisines: jest.fn(),
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getMyBusiness: jest.fn(),
}));
// The Menu and Photos rows load their own summary (spec 06). Mocked so that query can't fail
// late against the supabase mock and change the screen mid-test (the PR #8 lesson).
jest.mock('@/features/menu/api', () => ({
  ...jest.requireActual('@/features/menu/api'),
  getMenu: jest.fn(async () => ({ items: [], photos: [] })),
}));

const auth = supabase.auth as unknown as Record<string, jest.Mock>;
const mockedGetBusiness = getMyBusiness as unknown as jest.Mock;
const mockedProfile = profileApi.getMyProfile as unknown as jest.Mock;
const mockedCuisines = listCuisines as unknown as jest.Mock;

const session = { access_token: 't', refresh_token: 'r', user: { id: 'u1' } };
const profile: profileApi.Profile = {
  id: 'u1',
  username: 'archan',
  display_name: 'Archan Me',
  bio: '',
  city: '',
  is_seller: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const restaurant: MyBusiness = {
  id: 'b1',
  type: 'restaurant',
  name: "Joe's Pizza",
  cuisine_code: 'IT',
  accepts_table_requests: true,
  map_lat: 43.65,
  map_lng: -79.38,
  public_address: '1 Main St, Toronto, ON',
  is_listed: true,
  currency_code: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  location: { formatted_address: '1 Main St, Toronto, ON', lat: 43.65, lng: -79.38 },
};
const homemade: MyBusiness = {
  ...restaurant,
  id: 'b2',
  type: 'homemade',
  name: "Gran's Kitchen",
  accepts_table_requests: false,
  public_address: null,
  map_lat: 43.66,
  map_lng: -79.39,
  location: { formatted_address: '9 Elm Rd, Toronto, ON', lat: 43.65, lng: -79.38 },
};

// Manage opens seller screens with push, so Back returns to Manage. A UX choice; the spec fixes
// only the destination.
function expectPushedOnly(path: string) {
  expect(mockRouter.push).toHaveBeenCalledTimes(1);
  expect(mockRouter.push).toHaveBeenCalledWith(path);
  expect(mockRouter.replace).not.toHaveBeenCalled();
}

async function renderScreen() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  await render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <ManageBusinessScreen />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetBusiness.mockReset();
  mockedGetBusiness.mockResolvedValue(restaurant);
  mockedProfile.mockReset();
  mockedProfile.mockResolvedValue(profile);
  (getMenu as unknown as jest.Mock).mockReset();
  (getMenu as unknown as jest.Mock).mockResolvedValue({ items: [], photos: [] });
  mockedCuisines.mockReset();
  mockedCuisines.mockResolvedValue([
    { code: 'IT', kind: 'country', name: 'Italy', flag: '🇮🇹', icon: null, sort_order: 100 },
  ]);
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  auth.getSession.mockResolvedValue({ data: { session } });
});

const NOT_FOUND_HOME =
  "Hidden from the map: Google can't find your address any more. Choose your address again to put your approximate area back.";
const REFRESH_HOME =
  'Hidden from the map for now while we re-check your address. Choosing your address again puts your approximate area back at once.';
const VISIBLE_HOME = 'Showing on the map as an approximate area';

describe('ManageBusinessScreen map status for a homemade seller (spec 08)', () => {
  it('says "Showing on the map as an approximate area" when visible, with no button', async () => {
    mockedGetBusiness.mockResolvedValue({ ...homemade, map_status: 'visible' });
    await renderScreen();
    expect(await screen.findByText(VISIBLE_HOME)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Choose your address again' })).toBeNull();
  });

  it('explains a place Google can no longer find, and the button opens the address screen', async () => {
    mockedGetBusiness.mockResolvedValue({ ...homemade, map_status: 'place_not_found' });
    await renderScreen();
    expect(await screen.findByText(NOT_FOUND_HOME)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose your address again' }));
    expectPushedOnly('/seller/address');
  });

  it('explains a listing hidden while the address is re-checked, with the way back', async () => {
    mockedGetBusiness.mockResolvedValue({ ...homemade, map_status: 'needs_refresh' });
    await renderScreen();
    expect(await screen.findByText(REFRESH_HOME)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose your address again' }));
    expectPushedOnly('/seller/address');
  });

  it('never uses the restaurant wording for a homemade seller', async () => {
    mockedGetBusiness.mockResolvedValue({ ...homemade, map_status: 'visible' });
    await renderScreen();
    await screen.findByText(VISIBLE_HOME);
    expect(screen.queryByText('Showing on the map')).toBeNull();
  });

  it.each([
    ['null (no saved address on the server)', { map_status: null }],
    ['missing (an older payload)', {}],
  ])('shows no status line when it is %s', async (_label, extra) => {
    mockedGetBusiness.mockResolvedValue({ ...homemade, ...extra });
    await renderScreen();
    expect(await screen.findByText("Gran's Kitchen")).toBeTruthy();
    expect(screen.queryByText(VISIBLE_HOME)).toBeNull();
  });

  it('shows no status line without a saved address, or with seller mode off', async () => {
    mockedGetBusiness.mockResolvedValue({
      ...homemade,
      location: null,
      public_address: null,
      map_lat: null,
      map_lng: null,
      map_status: 'visible',
    });
    await renderScreen();
    expect(await screen.findByText('Add address')).toBeTruthy();
    expect(screen.queryByText(VISIBLE_HOME)).toBeNull();
    await cleanup();
    mockedGetBusiness.mockResolvedValue({ ...homemade, is_listed: false, map_status: 'visible' });
    await renderScreen();
    expect(await screen.findByText('Hidden — seller mode is off')).toBeTruthy();
    expect(screen.queryByText(VISIBLE_HOME)).toBeNull();
  });

  it('a restaurant owner still sees the restaurant wording', async () => {
    mockedGetBusiness.mockResolvedValue({ ...restaurant, map_status: 'visible' });
    await renderScreen();
    expect(await screen.findByText('Showing on the map')).toBeTruthy();
    expect(screen.queryByText(VISIBLE_HOME)).toBeNull();
  });
});

describe('MapStatusLine wording by kind', () => {
  it('keeps the restaurant strings exactly as spec 07 fixed them', () => {
    expect(MAP_STATUS_MESSAGE.visible).toBe('Showing on the map');
    expect(MAP_STATUS_MESSAGE.place_not_found).toBe(
      "Hidden from the map: Google can't find your address any more. Choose your address again to put it back.",
    );
  });

  it('uses the homemade strings for kind="homemade", with a labelled button when hidden', async () => {
    const onChooseAddress = jest.fn();
    await render(
      <MapStatusLine status="needs_refresh" kind="homemade" onChooseAddress={onChooseAddress} />,
    );
    expect(screen.getByText(HOMEMADE_MAP_STATUS_MESSAGE.needs_refresh)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose your address again' }));
    expect(onChooseAddress).toHaveBeenCalledTimes(1);
  });

  it('defaults to the restaurant wording', async () => {
    await render(<MapStatusLine status="visible" onChooseAddress={jest.fn()} />);
    expect(screen.getByText('Showing on the map')).toBeTruthy();
  });
});
