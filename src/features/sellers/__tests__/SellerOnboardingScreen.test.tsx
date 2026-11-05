import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AuthProvider } from '@/features/auth/components/AuthProvider';
import { listCuisines } from '@/features/cuisines/api';
import * as profileApi from '@/features/profile/api';
import { supabase } from '@/lib/supabase';

import {
  SellerAppError,
  autocompletePlaces,
  createMyBusiness,
  getMyBusiness,
  resolvePlace,
} from '../api';
import { SellerOnboardingScreen } from '../components/SellerOnboardingScreen';
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
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-onboarding') }));
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
  createMyBusiness: jest.fn(),
  autocompletePlaces: jest.fn(),
  resolvePlace: jest.fn(),
}));

const auth = supabase.auth as unknown as Record<string, jest.Mock>;
const mockedGetBusiness = getMyBusiness as unknown as jest.Mock;
const mockedCreate = createMyBusiness as unknown as jest.Mock;
const mockedAutocomplete = autocompletePlaces as unknown as jest.Mock;
const mockedResolve = resolvePlace as unknown as jest.Mock;
const mockedProfile = profileApi.getMyProfile as unknown as jest.Mock;
const mockedCuisines = listCuisines as unknown as jest.Mock;

const session = { access_token: 't', refresh_token: 'r', user: { id: 'u1' } };
const baseProfile: profileApi.Profile = {
  id: 'u1',
  username: 'archan',
  display_name: 'Archan Me',
  bio: '',
  city: '',
  is_seller: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const noLocation: MyBusiness = {
  id: 'b1',
  type: 'restaurant',
  name: "Joe's Pizza",
  cuisine_code: 'IT',
  accepts_table_requests: true,
  map_lat: null,
  map_lng: null,
  public_address: null,
  is_listed: true,
  currency_code: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  location: null,
};
const withLocation: MyBusiness = {
  ...noLocation,
  map_lat: 43.65,
  map_lng: -79.38,
  public_address: '123 Main St, Toronto, ON, Canada',
  location: { formatted_address: '123 Main St, Toronto, ON, Canada', lat: 43.65, lng: -79.38 },
};

const suggestion = {
  placeId: 'p1',
  primaryText: '123 Main St',
  secondaryText: 'Toronto, ON, Canada',
};

const cuisines = [
  { code: 'IT', kind: 'country', name: 'Italy', flag: '🇮🇹', icon: null, sort_order: 100 },
  { code: 'FR', kind: 'country', name: 'France', flag: '🇫🇷', icon: null, sort_order: 120 },
];

// Live "server" state the mocked api reads from.
let business: MyBusiness | null;
let profile: profileApi.Profile;

// A user's flip of an RN Switch fires onValueChange; a Switch has no press handler. The form
// field drives the switch, so it must show the new value afterwards.
async function setTables(next: boolean) {
  const get = () => screen.getByRole('switch', { name: 'Accept table requests' });
  await fireEvent(get(), 'valueChange', next);
  if (next) expect(get()).toBeChecked();
  else expect(get()).not.toBeChecked();
}

// Only used for "has not navigated" checks; positive checks pin the exact method.
function navigatedTo(path: string) {
  return [...mockRouter.push.mock.calls, ...mockRouter.replace.mock.calls].some(
    (call: unknown[]) => call[0] === path,
  );
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
        <SellerOnboardingScreen />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return client;
}

async function pickType(type: 'Restaurant' | 'Homemade') {
  await fireEvent.press(await screen.findByRole('radio', { name: type }));
}

async function pickCuisine(name: string) {
  await fireEvent.press(await screen.findByLabelText(/^Cuisine:/));
  await fireEvent.press(await screen.findByRole('radio', { name }));
}

async function fillStep1(type: 'Restaurant' | 'Homemade', name: string, cuisine = 'Italy') {
  await pickType(type);
  await fireEvent.changeText(await screen.findByLabelText('Business name'), name);
  await pickCuisine(cuisine);
}

beforeEach(() => {
  jest.clearAllMocks();
  business = null;
  profile = { ...baseProfile };
  mockedGetBusiness.mockReset();
  mockedGetBusiness.mockImplementation(async () => business);
  mockedProfile.mockReset();
  mockedProfile.mockImplementation(async () => profile);
  mockedCreate.mockReset();
  mockedCreate.mockImplementation(async (input: { accepts_table_requests: boolean }) => {
    business = { ...noLocation, accepts_table_requests: input.accepts_table_requests };
    profile = { ...profile, is_seller: true };
    return 'b1';
  });
  mockedAutocomplete.mockReset();
  mockedAutocomplete.mockResolvedValue([suggestion]);
  mockedResolve.mockReset();
  mockedResolve.mockImplementation(async () => {
    business = withLocation;
    return withLocation;
  });
  mockedCuisines.mockReset();
  mockedCuisines.mockResolvedValue(cuisines);
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  auth.getSession.mockResolvedValue({ data: { session } });
});

describe('SellerOnboardingScreen states', () => {
  it('shows the seller skeleton while the business loads, with no redirect', async () => {
    mockedGetBusiness.mockReturnValue(new Promise(() => {}));
    await renderScreen();
    expect(screen.getByTestId('seller-skeleton')).toBeTruthy();
    expect(screen.getByLabelText('Loading your business')).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('shows an error with a Try again button that reloads', async () => {
    mockedGetBusiness.mockRejectedValueOnce(new SellerAppError('network'));
    await renderScreen();
    expect(await screen.findByRole('alert')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('header', { name: 'Start selling' })).toBeTruthy();
    expect(mockedGetBusiness).toHaveBeenCalledTimes(2);
  });

  it('redirects a user who already has a business and seller mode on to /manage', async () => {
    business = withLocation;
    profile = { ...baseProfile, is_seller: true };
    await renderScreen();
    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith('/manage'));
  });

  it('redirects a user who has a business and seller mode off to /profile', async () => {
    business = { ...withLocation, is_listed: false };
    profile = { ...baseProfile, is_seller: false };
    await renderScreen();
    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith('/profile'));
  });

  it('stays on onboarding when there is no business', async () => {
    await renderScreen();
    expect(await screen.findByRole('header', { name: 'Start selling' })).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

describe('SellerOnboardingScreen step 1', () => {
  it('shows the step label and the form', async () => {
    await renderScreen();
    expect(await screen.findByRole('header', { name: 'Start selling' })).toBeTruthy();
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Restaurant' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Homemade' })).toBeTruthy();
    expect(screen.getByLabelText('Business name')).toBeTruthy();
    expect(screen.getByLabelText('Cuisine: Not chosen')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });

  it('marks the chosen type as checked and the other as not', async () => {
    await renderScreen();
    await pickType('Homemade');
    expect(screen.getByRole('radio', { name: 'Homemade' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Restaurant' })).not.toBeChecked();
    await pickType('Restaurant');
    expect(screen.getByRole('radio', { name: 'Restaurant' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Homemade' })).not.toBeChecked();
  });

  it('shows the table-requests switch only for Restaurant, off by default', async () => {
    await renderScreen();
    await pickType('Restaurant');
    expect(await screen.findByRole('switch', { name: 'Accept table requests' })).not.toBeChecked();

    await pickType('Homemade');
    expect(screen.queryByRole('switch', { name: 'Accept table requests' })).toBeNull();
  });

  it('shows validation messages and does not create when the form is empty', async () => {
    await renderScreen();
    await pickType('Restaurant');
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('⚠ Enter your business name')).toBeTruthy();
    expect(screen.getByText('⚠ Pick a cuisine')).toBeTruthy();
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(screen.queryByText('Step 2 of 2')).toBeNull();
  });

  it('rejects a name over 60 characters', async () => {
    await renderScreen();
    await fillStep1('Restaurant', 'a'.repeat(61));
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('⚠ Use 60 characters or fewer')).toBeTruthy();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only name', async () => {
    await renderScreen();
    await fillStep1('Restaurant', '     ');
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('⚠ Enter your business name')).toBeTruthy();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('creates a restaurant with the trimmed name, cuisine and table setting', async () => {
    await renderScreen();
    await fillStep1('Restaurant', "  Joe's Pizza  ");
    await setTables(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate.mock.calls[0][0]).toEqual({
      type: 'restaurant',
      name: "Joe's Pizza",
      cuisine_code: 'IT',
      accepts_table_requests: true,
    });
  });

  it('creates a restaurant with table requests off by default', async () => {
    await renderScreen();
    await fillStep1('Restaurant', "Joe's Pizza");
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate.mock.calls[0][0].accepts_table_requests).toBe(false);
  });

  it('saves false for table requests on Homemade, even if it was switched on for Restaurant first', async () => {
    await renderScreen();
    await pickType('Restaurant');
    await setTables(true);
    await fillStep1('Homemade', "Gran's Kitchen", 'France');
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate.mock.calls[0][0]).toEqual({
      type: 'homemade',
      name: "Gran's Kitchen",
      cuisine_code: 'FR',
      accepts_table_requests: false,
    });
  });

  it('shows the already-has-business error with a Go to Manage Business button', async () => {
    mockedCreate.mockRejectedValue(new SellerAppError('already_has_business'));
    await renderScreen();
    await fillStep1('Restaurant', "Joe's Pizza");
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(sellerErrorMessage('already_has_business'))).toBeTruthy();
    expect(screen.queryByText('Step 2 of 2')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Go to Manage Business' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/manage');
  });

  it('Go to Manage Business replaces the route with /manage and does not push', async () => {
    // push vs replace is a UX choice the spec doesn't fix. We use replace so that Back does not
    // reopen onboarding for a user who already has a business.
    mockedCreate.mockRejectedValue(new SellerAppError('already_has_business'));
    await renderScreen();
    await fillStep1('Restaurant', "Joe's Pizza");
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(sellerErrorMessage('already_has_business'))).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Go to Manage Business' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/manage');
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('shows other create errors and stays on step 1', async () => {
    mockedCreate.mockRejectedValue(new SellerAppError('invalid_input'));
    await renderScreen();
    await fillStep1('Restaurant', "Joe's Pizza");
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(sellerErrorMessage('invalid_input'))).toBeTruthy();
    expect(screen.queryByText('Step 2 of 2')).toBeNull();
  });
});

describe('SellerOnboardingScreen step 2', () => {
  async function toStep2(type: 'Restaurant' | 'Homemade' = 'Restaurant') {
    await fillStep1(type, "Joe's Pizza");
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    return screen.findByRole('header', { name: 'Your address' });
  }

  it('moves to the address step after the business is created', async () => {
    await renderScreen();
    expect(await toStep2()).toBeTruthy();
    expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    expect(screen.getByLabelText('Address')).toBeTruthy();
  });

  it('shows the privacy note for a homemade seller', async () => {
    await renderScreen();
    await toStep2('Homemade');
    expect(screen.getByText(ADDRESS_PRIVACY_NOTE)).toBeTruthy();
  });

  it('does not show the privacy note for a restaurant', async () => {
    await renderScreen();
    await toStep2('Restaurant');
    expect(screen.queryByText(ADDRESS_PRIVACY_NOTE)).toBeNull();
  });

  it('does not redirect to /manage when the refetched business and profile say seller (self-redirect)', async () => {
    await renderScreen();
    await toStep2();

    // The create refreshed the business and the profile: a business now exists and is_seller is true.
    await waitFor(() => expect(mockedGetBusiness.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(mockedProfile.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.getByText('Step 2 of 2')).toBeTruthy());

    expect(screen.getByRole('header', { name: 'Your address' })).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalledWith('/manage');
    expect(mockRedirect).not.toHaveBeenCalledWith('/profile');
    expect(navigatedTo('/manage')).toBe(false);
  });

  it('goes to /manage only after an address is resolved', async () => {
    await renderScreen();
    await toStep2();
    await waitFor(() => expect(mockedProfile.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(navigatedTo('/manage')).toBe(false);

    await fireEvent.changeText(screen.getByLabelText('Address'), '123 Main');
    const row = await screen.findByRole('button', { name: '123 Main St, Toronto, ON, Canada' });
    expect(navigatedTo('/manage')).toBe(false);
    await fireEvent.press(row);

    // Replace, so Back doesn't reopen the finished wizard. A UX choice; the spec says only
    // "On success → /manage".
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/manage'));
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockedResolve).toHaveBeenCalledTimes(1);
    expect(mockedResolve.mock.calls[0][0]).toBe('p1');
  });

  it('stays on the address step when resolving the place fails', async () => {
    mockedResolve.mockRejectedValue(new SellerAppError('not_a_place'));
    await renderScreen();
    await toStep2();
    await fireEvent.changeText(screen.getByLabelText('Address'), '123 Main');
    await fireEvent.press(
      await screen.findByRole('button', { name: '123 Main St, Toronto, ON, Canada' }),
    );
    expect(await screen.findByText(sellerErrorMessage('not_a_place'))).toBeTruthy();
    expect(navigatedTo('/manage')).toBe(false);
    expect(screen.getByText('Step 2 of 2')).toBeTruthy();
  });
});
