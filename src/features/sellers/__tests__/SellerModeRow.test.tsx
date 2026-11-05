import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AuthProvider } from '@/features/auth/components/AuthProvider';
import * as profileApi from '@/features/profile/api';
import { supabase } from '@/lib/supabase';

import { SellerAppError, getMyBusiness, setSellerMode } from '../api';
import { SellerModeRow } from '../components/SellerModeRow';
import { sellerErrorMessage } from '../messages';
import type { MyBusiness } from '../schema';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  setParams: jest.fn(),
};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Redirect: () => null,
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: jest.fn(), getSession: jest.fn() } },
}));
jest.mock('@/features/profile/api', () => ({
  ...jest.requireActual('@/features/profile/api'),
  getMyProfile: jest.fn(),
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getMyBusiness: jest.fn(),
  setSellerMode: jest.fn(),
}));

const auth = supabase.auth as unknown as Record<string, jest.Mock>;
const mockedGetBusiness = getMyBusiness as unknown as jest.Mock;
const mockedSetMode = setSellerMode as unknown as jest.Mock;
const mockedProfile = profileApi.getMyProfile as unknown as jest.Mock;

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
const listed: MyBusiness = {
  id: 'b1',
  type: 'restaurant',
  name: "Joe's Pizza",
  cuisine_code: 'IT',
  accepts_table_requests: true,
  map_lat: 43.65,
  map_lng: -79.38,
  public_address: '1 Main St',
  is_listed: true,
  currency_code: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  location: { formatted_address: '1 Main St, Toronto, ON', lat: 43.65, lng: -79.38 },
};

// A user's flip of an RN Switch fires onValueChange; a Switch has no press handler.
async function flipSeller(next: boolean) {
  await fireEvent(screen.getByRole('switch', { name: 'Seller mode' }), 'valueChange', next);
}

async function renderRow() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  await render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <SellerModeRow />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetBusiness.mockReset();
  mockedGetBusiness.mockResolvedValue(listed);
  mockedSetMode.mockReset();
  mockedSetMode.mockResolvedValue(undefined);
  mockedProfile.mockReset();
  mockedProfile.mockResolvedValue(profile);
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  auth.getSession.mockResolvedValue({ data: { session } });
});

describe('SellerModeRow', () => {
  it('shows a loading state while the business loads', async () => {
    mockedGetBusiness.mockReturnValue(new Promise(() => {}));
    await renderRow();
    expect(screen.getByLabelText('Loading seller mode')).toBeTruthy();
  });

  it('shows Start selling when there is no business, and it opens onboarding', async () => {
    mockedGetBusiness.mockResolvedValue(null);
    await renderRow();
    const start = await screen.findByRole('button', { name: 'Start selling' });
    expect(screen.queryByRole('switch')).toBeNull();
    await fireEvent.press(start);
    // Push, so Back returns to Profile. A UX choice; the spec fixes only the destination.
    expect(mockRouter.push).toHaveBeenCalledWith('/seller/onboarding');
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('shows a Seller mode switch when a business exists, with no Start selling button', async () => {
    await renderRow();
    expect(await screen.findByRole('switch', { name: 'Seller mode' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start selling' })).toBeNull();
  });

  it('shows the switch on when the listing is on', async () => {
    await renderRow();
    expect(await screen.findByRole('switch', { name: 'Seller mode' })).toBeChecked();
  });

  it('shows the switch off when seller mode is off', async () => {
    mockedGetBusiness.mockResolvedValue({ ...listed, is_listed: false });
    await renderRow();
    expect(await screen.findByRole('switch', { name: 'Seller mode' })).not.toBeChecked();
  });

  it('turning it off calls set_seller_mode(false)', async () => {
    await renderRow();
    await screen.findByRole('switch', { name: 'Seller mode' });
    await flipSeller(false);
    await waitFor(() => expect(mockedSetMode).toHaveBeenCalledTimes(1));
    expect(mockedSetMode.mock.calls[0][0]).toBe(false);
  });

  it('turning it on calls set_seller_mode(true)', async () => {
    mockedGetBusiness.mockResolvedValue({ ...listed, is_listed: false });
    await renderRow();
    await screen.findByRole('switch', { name: 'Seller mode' });
    await flipSeller(true);
    await waitFor(() => expect(mockedSetMode).toHaveBeenCalledTimes(1));
    expect(mockedSetMode.mock.calls[0][0]).toBe(true);
  });

  it('invalidates the profile and business queries after toggling', async () => {
    const client = await renderRow();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    await screen.findByRole('switch', { name: 'Seller mode' });
    await flipSeller(false);

    await waitFor(() => {
      const keys = invalidate.mock.calls.map((call) =>
        JSON.stringify((call[0] as { queryKey?: unknown } | undefined)?.queryKey),
      );
      expect(keys).toEqual(expect.arrayContaining(['["profile","me"]', '["business","me"]']));
    });
  });

  it('shows the error when toggling fails', async () => {
    mockedSetMode.mockRejectedValue(new SellerAppError('no_business'));
    await renderRow();
    await screen.findByRole('switch', { name: 'Seller mode' });
    await flipSeller(false);
    expect(await screen.findByText(sellerErrorMessage('no_business'))).toBeTruthy();
  });
});
