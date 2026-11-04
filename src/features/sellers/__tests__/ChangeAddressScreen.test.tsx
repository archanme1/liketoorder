import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AuthProvider } from '@/features/auth/components/AuthProvider';
import * as profileApi from '@/features/profile/api';
import { supabase } from '@/lib/supabase';

import { SellerAppError, autocompletePlaces, getMyBusiness, resolvePlace } from '../api';
import { ChangeAddressScreen } from '../components/ChangeAddressScreen';
import { ADDRESS_PRIVACY_NOTE, sellerErrorMessage } from '../messages';
import type { MyBusiness } from '../schema';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  setParams: jest.fn(),
  canGoBack: jest.fn(() => true),
};
const mockRedirect = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Redirect: ({ href }: { href: string }) => {
    mockRedirect(href);
    return null;
  },
  useLocalSearchParams: () => ({}),
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-address') }));
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
  autocompletePlaces: jest.fn(),
  resolvePlace: jest.fn(),
}));

const auth = supabase.auth as unknown as Record<string, jest.Mock>;
const mockedGetBusiness = getMyBusiness as unknown as jest.Mock;
const mockedAutocomplete = autocompletePlaces as unknown as jest.Mock;
const mockedResolve = resolvePlace as unknown as jest.Mock;
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
  location: { formatted_address: '9 Elm Rd, Toronto, ON', lat: 43.66, lng: -79.39 },
};
const updated: MyBusiness = {
  ...restaurant,
  public_address: '123 Main St, Toronto, ON, Canada',
  location: { formatted_address: '123 Main St, Toronto, ON, Canada', lat: 43.7, lng: -79.4 },
};

const suggestion = {
  placeId: 'p1',
  primaryText: '123 Main St',
  secondaryText: 'Toronto, ON, Canada',
};
const SUGGESTION_LABEL = '123 Main St, Toronto, ON, Canada';

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      jest.advanceTimersByTime(0);
    });
  }
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await settle();
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
        <ChangeAddressScreen />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return client;
}

// Types an address, waits out the debounce and presses the suggestion.
async function pickSuggestion() {
  await fireEvent.changeText(await screen.findByLabelText('Address'), '123 Main');
  await advance(300);
  await fireEvent.press(await screen.findByRole('button', { name: SUGGESTION_LABEL }));
  await settle();
}

function leftTheScreen() {
  return (
    mockRouter.back.mock.calls.length +
    mockRouter.replace.mock.calls.length +
    mockRouter.push.mock.calls.length
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRouter.canGoBack.mockReturnValue(true);
  mockedGetBusiness.mockReset();
  mockedGetBusiness.mockResolvedValue(restaurant);
  mockedAutocomplete.mockReset();
  mockedAutocomplete.mockResolvedValue([suggestion]);
  mockedResolve.mockReset();
  mockedResolve.mockResolvedValue(updated);
  mockedProfile.mockReset();
  mockedProfile.mockResolvedValue(profile);
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  auth.getSession.mockResolvedValue({ data: { session } });
});

describe('ChangeAddressScreen states', () => {
  it('shows the seller skeleton while the business loads', async () => {
    mockedGetBusiness.mockReturnValue(new Promise(() => {}));
    await renderScreen();
    expect(screen.getByTestId('seller-skeleton')).toBeTruthy();
    expect(screen.getByLabelText('Loading your business')).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('shows an error, and Try again loads the business again', async () => {
    mockedGetBusiness.mockRejectedValueOnce(new SellerAppError('network'));
    mockedGetBusiness.mockResolvedValueOnce(restaurant);
    await renderScreen();
    expect(await screen.findByText(sellerErrorMessage('network'))).toBeTruthy();
    const callsBefore = mockedGetBusiness.mock.calls.length;
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Address')).toBeTruthy();
    expect(mockedGetBusiness.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('redirects to onboarding when there is no business', async () => {
    mockedGetBusiness.mockResolvedValue(null);
    await renderScreen();
    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith('/seller/onboarding'));
  });
});

describe('ChangeAddressScreen current address', () => {
  it('shows the current address under a "Current address" label', async () => {
    await renderScreen();
    expect(await screen.findByText('Current address')).toBeTruthy();
    expect(screen.getByText('1 Main St, Toronto, ON')).toBeTruthy();
    expect(screen.getByLabelText('Address')).toBeTruthy();
  });

  it('shows "No address yet" when the business has no location', async () => {
    mockedGetBusiness.mockResolvedValue({
      ...restaurant,
      location: null,
      map_lat: null,
      map_lng: null,
      public_address: null,
    });
    await renderScreen();
    expect(await screen.findByText('No address yet')).toBeTruthy();
  });

  it('shows the privacy note for a homemade business', async () => {
    mockedGetBusiness.mockResolvedValue(homemade);
    await renderScreen();
    expect(await screen.findByText(ADDRESS_PRIVACY_NOTE)).toBeTruthy();
  });

  it('does not show the privacy note for a restaurant', async () => {
    await renderScreen();
    await screen.findByText('Current address');
    expect(screen.queryByText(ADDRESS_PRIVACY_NOTE)).toBeNull();
  });
});

describe('ChangeAddressScreen leaving after a save', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('goes back once, without replace or push, when it can go back', async () => {
    mockRouter.canGoBack.mockReturnValue(true);
    await renderScreen();
    await pickSuggestion();

    expect(mockedResolve).toHaveBeenCalledTimes(1);
    expect(mockedResolve.mock.calls[0][0]).toBe('p1');
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('replaces with /manage, and does not go back, when it cannot go back', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    await renderScreen();
    await pickSuggestion();

    expect(mockedResolve).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith('/manage');
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('does not leave when resolving fails, and shows the error', async () => {
    mockedResolve.mockRejectedValue(new SellerAppError('not_a_place'));
    await renderScreen();
    await pickSuggestion();

    expect(mockedResolve).toHaveBeenCalledTimes(1);
    expect(screen.getByText(sellerErrorMessage('not_a_place'))).toBeTruthy();
    expect(leftTheScreen()).toBe(0);
  });
});
