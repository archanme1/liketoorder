import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AuthProvider } from '@/features/auth/components/AuthProvider';
import { listCuisines } from '@/features/cuisines/api';
import * as profileApi from '@/features/profile/api';
import { supabase } from '@/lib/supabase';

import { SellerAppError, getMyBusiness, updateMyBusiness } from '../api';
import { EditBusinessScreen } from '../components/EditBusinessScreen';
import { sellerErrorMessage } from '../messages';
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
  updateMyBusiness: jest.fn(),
}));

const auth = supabase.auth as unknown as Record<string, jest.Mock>;
const mockedGetBusiness = getMyBusiness as unknown as jest.Mock;
const mockedUpdate = updateMyBusiness as unknown as jest.Mock;
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
  public_address: '1 Main St',
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
};

const cuisines = [
  { code: 'IT', kind: 'country', name: 'Italy', flag: '🇮🇹', icon: null, sort_order: 100 },
  { code: 'FR', kind: 'country', name: 'France', flag: '🇫🇷', icon: null, sort_order: 120 },
];

type Element = ReturnType<typeof screen.getByRole>;

function isOn(el: Element): boolean {
  try {
    expect(el).toBeChecked();
    return true;
  } catch {
    return false;
  }
}

// A switch may be a bare Switch (valueChange) or wrapped in a pressable; try the value change first.
async function setSwitch(next: boolean) {
  const get = () => screen.getByRole('switch', { name: 'Accept table requests' });
  if (isOn(get()) === next) return;
  await fireEvent(get(), 'valueChange', next);
  if (isOn(get()) !== next) await fireEvent.press(get());
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
        <EditBusinessScreen />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetBusiness.mockReset();
  mockedGetBusiness.mockResolvedValue(restaurant);
  mockedUpdate.mockReset();
  mockedUpdate.mockImplementation(async (_id: string, patch: object) => ({
    ...restaurant,
    ...patch,
  }));
  mockedProfile.mockReset();
  mockedProfile.mockResolvedValue(profile);
  mockedCuisines.mockReset();
  mockedCuisines.mockResolvedValue(cuisines);
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  auth.getSession.mockResolvedValue({ data: { session } });
});

describe('EditBusinessScreen states and access', () => {
  it('shows the seller skeleton while the business loads', async () => {
    mockedGetBusiness.mockReturnValue(new Promise(() => {}));
    await renderScreen();
    expect(screen.getByTestId('seller-skeleton')).toBeTruthy();
    expect(screen.getByLabelText('Loading your business')).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('does not redirect while loading, then redirects to onboarding when there is no business', async () => {
    mockedGetBusiness.mockResolvedValue(null);
    await renderScreen();
    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith('/seller/onboarding'));
  });

  it('shows an error with a Try again button that reloads', async () => {
    mockedGetBusiness.mockRejectedValueOnce(new SellerAppError('network'));
    mockedGetBusiness.mockResolvedValueOnce(restaurant);
    await renderScreen();
    expect(await screen.findByRole('alert')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Business name')).toBeTruthy();
    expect(mockedGetBusiness).toHaveBeenCalledTimes(2);
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

describe('EditBusinessScreen form', () => {
  it('prefills the current values', async () => {
    await renderScreen();
    expect(await screen.findByLabelText('Business name')).toHaveDisplayValue("Joe's Pizza");
    expect(await screen.findByLabelText('Cuisine: Italy')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Accept table requests' })).toBeChecked();
  });

  it('shows the business type as read-only text', async () => {
    await renderScreen();
    await screen.findByLabelText('Business name');
    expect(screen.getByText('Business type')).toBeTruthy();
    expect(screen.getByText('Restaurant')).toBeTruthy();
    expect(screen.getByText('The type can’t be changed.')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Restaurant' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Homemade' })).toBeNull();
  });

  it('shows a homemade type as read-only too', async () => {
    mockedGetBusiness.mockResolvedValue(homemade);
    await renderScreen();
    await screen.findByLabelText('Business name');
    expect(screen.getByText('Homemade')).toBeTruthy();
    expect(screen.getByText('The type can’t be changed.')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('shows the table-requests switch only for a restaurant', async () => {
    mockedGetBusiness.mockResolvedValue(homemade);
    await renderScreen();
    await screen.findByLabelText('Business name');
    expect(screen.queryByRole('switch', { name: 'Accept table requests' })).toBeNull();
  });

  it('labels Save and Cancel as buttons', async () => {
    await renderScreen();
    await screen.findByLabelText('Business name');
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });
});

describe('EditBusinessScreen saving', () => {
  it('saves only name, cuisine and table setting for the business id', async () => {
    await renderScreen();
    const name = await screen.findByLabelText('Business name');
    await fireEvent.changeText(name, '  New Name  ');
    await setSwitch(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
    const [id, patch] = mockedUpdate.mock.calls[0];
    expect(id).toBe('b1');
    expect(patch).toEqual({
      name: 'New Name',
      cuisine_code: 'IT',
      accepts_table_requests: false,
    });
    for (const forbidden of [
      'type',
      'is_listed',
      'map_lat',
      'map_lng',
      'public_address',
      'owner_id',
    ]) {
      expect(patch).not.toHaveProperty(forbidden);
    }
  });

  it('can change the cuisine from the cuisine field', async () => {
    await renderScreen();
    await screen.findByLabelText('Business name');
    await fireEvent.press(await screen.findByLabelText('Cuisine: Italy'));
    await fireEvent.press(await screen.findByRole('radio', { name: 'France' }));
    expect(await screen.findByLabelText('Cuisine: France')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
    expect(mockedUpdate.mock.calls[0][1]).toMatchObject({ cuisine_code: 'FR' });
  });

  it('saves false for table requests on a homemade business', async () => {
    mockedGetBusiness.mockResolvedValue(homemade);
    await renderScreen();
    const name = await screen.findByLabelText('Business name');
    await fireEvent.changeText(name, 'Gran’s Table');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
    expect(mockedUpdate.mock.calls[0][0]).toBe('b2');
    expect(mockedUpdate.mock.calls[0][1]).toMatchObject({
      name: 'Gran’s Table',
      accepts_table_requests: false,
    });
    expect(mockedUpdate.mock.calls[0][1]).not.toHaveProperty('type');
  });

  it('refreshes the business and profile queries after a save', async () => {
    const client = await renderScreen();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const name = await screen.findByLabelText('Business name');
    await fireEvent.changeText(name, 'Renamed');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalled());
    await waitFor(() => {
      const keys = invalidate.mock.calls.map((call) =>
        JSON.stringify((call[0] as { queryKey?: unknown } | undefined)?.queryKey),
      );
      expect(keys).toEqual(expect.arrayContaining(['["business","me"]', '["profile","me"]']));
    });
  });

  it('shows the validation message for an empty name and does not save', async () => {
    await renderScreen();
    const name = await screen.findByLabelText('Business name');
    await fireEvent.changeText(name, '   ');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('⚠ Enter your business name')).toBeTruthy();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('shows the validation message for a name over 60 characters and does not save', async () => {
    await renderScreen();
    const name = await screen.findByLabelText('Business name');
    await fireEvent.changeText(name, 'a'.repeat(61));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('⚠ Use 60 characters or fewer')).toBeTruthy();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('shows the server error when saving fails', async () => {
    mockedUpdate.mockRejectedValue(new SellerAppError('invalid_input'));
    await renderScreen();
    const name = await screen.findByLabelText('Business name');
    await fireEvent.changeText(name, 'Renamed');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(sellerErrorMessage('invalid_input'))).toBeTruthy();
  });

  it('Cancel leaves without saving', async () => {
    await renderScreen();
    const name = await screen.findByLabelText('Business name');
    await fireEvent.changeText(name, 'Changed but cancelled');
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockedUpdate).not.toHaveBeenCalled();
    const left =
      mockRouter.back.mock.calls.length +
      mockRouter.replace.mock.calls.length +
      mockRouter.push.mock.calls.length;
    expect(left).toBeGreaterThan(0);
  });
});
