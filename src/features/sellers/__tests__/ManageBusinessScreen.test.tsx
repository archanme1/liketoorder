import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { AuthProvider } from '@/features/auth/components/AuthProvider';
import { listCuisines } from '@/features/cuisines/api';
import * as profileApi from '@/features/profile/api';
import { supabase } from '@/lib/supabase';

import { SellerAppError, getMyBusiness } from '../api';
import { ManageBusinessScreen } from '../components/ManageBusinessScreen';
import { LISTING_STATUS_LABEL } from '../listing';
import { sellerErrorMessage } from '../messages';
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
  mockedCuisines.mockReset();
  mockedCuisines.mockResolvedValue([
    { code: 'IT', kind: 'country', name: 'Italy', flag: '🇮🇹', icon: null, sort_order: 100 },
  ]);
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  auth.getSession.mockResolvedValue({ data: { session } });
});

describe('ManageBusinessScreen states', () => {
  it('shows the loading skeleton while the business loads', async () => {
    mockedGetBusiness.mockReturnValue(new Promise(() => {}));
    await renderScreen();
    expect(screen.getByLabelText('Loading your business')).toBeTruthy();
  });

  it('shows an error with a Try again button that reloads', async () => {
    mockedGetBusiness.mockRejectedValueOnce(new SellerAppError('network'));
    mockedGetBusiness.mockResolvedValueOnce(restaurant);
    await renderScreen();
    expect(await screen.findByRole('alert')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText("Joe's Pizza")).toBeTruthy();
    expect(mockedGetBusiness).toHaveBeenCalledTimes(2);
  });

  it('shows the error message for the failure', async () => {
    mockedGetBusiness.mockRejectedValue(new SellerAppError('network'));
    await renderScreen();
    expect(await screen.findByText(sellerErrorMessage('network'))).toBeTruthy();
  });

  it('shows the empty state with Start selling when there is no business', async () => {
    mockedGetBusiness.mockResolvedValue(null);
    await renderScreen();
    expect(await screen.findByText('You don’t have a business yet.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Start selling' }));
    expectPushedOnly('/seller/onboarding');
  });

  it('shows the business on success under a Manage Business header', async () => {
    await renderScreen();
    expect(await screen.findByRole('header', { name: 'Manage Business' })).toBeTruthy();
    expect(await screen.findByText("Joe's Pizza")).toBeTruthy();
  });
});

describe('ManageBusinessScreen details', () => {
  it('shows name, type, cuisine, address and table setting for a restaurant', async () => {
    await renderScreen();
    expect(await screen.findByText("Joe's Pizza")).toBeTruthy();
    expect(screen.getByText('Business name')).toBeTruthy();
    expect(screen.getByText('Type')).toBeTruthy();
    expect(screen.getByText('Restaurant')).toBeTruthy();
    expect(screen.getByText('Cuisine')).toBeTruthy();
    expect(await screen.findByText('Italy')).toBeTruthy();
    expect(screen.getByText('Address')).toBeTruthy();
    expect(screen.getByText('1 Main St, Toronto, ON')).toBeTruthy();
    expect(screen.getByText('Table requests')).toBeTruthy();
    expect(screen.getByText('Accepted')).toBeTruthy();
  });

  it('shows "Not accepted" when a restaurant turns table requests off', async () => {
    mockedGetBusiness.mockResolvedValue({ ...restaurant, accepts_table_requests: false });
    await renderScreen();
    expect(await screen.findByText('Not accepted')).toBeTruthy();
  });

  it('hides the table setting for a homemade business', async () => {
    mockedGetBusiness.mockResolvedValue(homemade);
    await renderScreen();
    expect(await screen.findByText("Gran's Kitchen")).toBeTruthy();
    expect(screen.getByText('Homemade')).toBeTruthy();
    expect(screen.queryByText('Table requests')).toBeNull();
    expect(screen.queryByText('Accepted')).toBeNull();
    expect(screen.queryByText('Not accepted')).toBeNull();
  });

  it('shows the owner their own exact address for a homemade business', async () => {
    mockedGetBusiness.mockResolvedValue(homemade);
    await renderScreen();
    expect(await screen.findByText('9 Elm Rd, Toronto, ON')).toBeTruthy();
  });
});

describe('ManageBusinessScreen listing status', () => {
  it('says Live when listed with an address', async () => {
    await renderScreen();
    expect(
      await screen.findByLabelText(`Listing status: ${LISTING_STATUS_LABEL.live}`),
    ).toBeTruthy();
    expect(LISTING_STATUS_LABEL.live).toBe('Live');
  });

  it('says Hidden when seller mode is off', async () => {
    mockedGetBusiness.mockResolvedValue({ ...restaurant, is_listed: false });
    await renderScreen();
    expect(
      await screen.findByLabelText('Listing status: Hidden — seller mode is off'),
    ).toBeTruthy();
  });

  it('says "Add your address to go live" when there is no location yet', async () => {
    mockedGetBusiness.mockResolvedValue({
      ...restaurant,
      location: null,
      map_lat: null,
      map_lng: null,
      public_address: null,
    });
    await renderScreen();
    expect(
      await screen.findByLabelText('Listing status: Add your address to go live'),
    ).toBeTruthy();
  });

  it('offers Add address when there is no location, and it opens the address screen', async () => {
    mockedGetBusiness.mockResolvedValue({
      ...restaurant,
      location: null,
      map_lat: null,
      map_lng: null,
      public_address: null,
    });
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Add address' }));
    expectPushedOnly('/seller/address');
  });

  it('does not offer Add address when an address exists', async () => {
    await renderScreen();
    await screen.findByText("Joe's Pizza");
    expect(screen.queryByRole('button', { name: 'Add address' })).toBeNull();
  });
});

describe('ManageBusinessScreen actions', () => {
  it('Edit details opens the edit screen', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Edit details' }));
    expectPushedOnly('/seller/edit');
  });

  it('Change address opens the address screen', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Change address' }));
    expectPushedOnly('/seller/address');
  });
});
