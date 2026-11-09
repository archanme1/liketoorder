import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AuthProvider } from '@/features/auth/components/AuthProvider';
import { listCuisines } from '@/features/cuisines/api';
import { getMenu } from '@/features/menu/api';
import * as profileApi from '@/features/profile/api';
import { RequestAppError, countWaitingRequests } from '@/features/requests/api';
import { PENDING_POLL_MS } from '@/features/requests/hooks/keys';
import { supabase } from '@/lib/supabase';

import { getMyBusiness } from '../api';
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
jest.mock('@/features/menu/api', () => ({
  ...jest.requireActual('@/features/menu/api'),
  getMenu: jest.fn(async () => ({ items: [], photos: [] })),
}));
jest.mock('@/features/requests/api', () => ({
  ...jest.requireActual('@/features/requests/api'),
  countWaitingRequests: jest.fn(),
}));

const auth = supabase.auth as unknown as Record<string, jest.Mock>;
const countMock = jest.mocked(countWaitingRequests);
const NOW = '2026-11-08T17:00:00Z';

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

let client: QueryClient;
async function renderScreen() {
  client = new QueryClient({
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
}
const requestsRow = () => screen.findByRole('button', { name: /^Requests/ });

beforeEach(() => {
  jest.clearAllMocks();
  (getMyBusiness as unknown as jest.Mock).mockResolvedValue(restaurant);
  (profileApi.getMyProfile as unknown as jest.Mock).mockResolvedValue(profile);
  (getMenu as unknown as jest.Mock).mockResolvedValue({ items: [], photos: [] });
  (listCuisines as unknown as jest.Mock).mockResolvedValue([
    { code: 'IT', kind: 'country', name: 'Italy', flag: '🇮🇹', icon: null, sort_order: 100 },
  ]);
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  auth.getSession.mockResolvedValue({ data: { session } });
  countMock.mockReset();
  countMock.mockResolvedValue({ server_now: NOW, waiting: 3 });
});

afterEach(async () => {
  jest.useRealTimers();
  await cleanup();
  client.clear();
});

describe('Manage → Requests row', () => {
  it('shows how many requests are waiting, read as one line', async () => {
    await renderScreen();
    const row = await requestsRow();
    await waitFor(() => expect(row.props.accessibilityLabel).toBe('Requests: 3 waiting'));
  });

  it('says "Nothing waiting" for zero', async () => {
    countMock.mockResolvedValue({ server_now: NOW, waiting: 0 });
    await renderScreen();
    await waitFor(async () =>
      expect((await requestsRow()).props.accessibilityLabel).toBe('Requests: Nothing waiting'),
    );
  });

  it('shows a skeleton while the count loads, and the row already opens', async () => {
    countMock.mockReturnValue(new Promise(() => undefined));
    await renderScreen();
    const row = await requestsRow();
    expect(row.props.accessibilityLabel).toBe('Requests');
    await fireEvent.press(row);
    expect(mockRouter.push).toHaveBeenCalledWith('/seller/requests');
  });

  it('when the count fails the row says so and still opens the inbox', async () => {
    countMock.mockRejectedValue(new RequestAppError('network'));
    await renderScreen();
    await waitFor(async () =>
      expect((await requestsRow()).props.accessibilityLabel).toBe(
        'Requests: Couldn’t load the count',
      ),
    );
    await fireEvent.press(await requestsRow());
    expect(mockRouter.push).toHaveBeenCalledWith('/seller/requests');
    // The rest of Manage is not affected.
    expect(screen.getByText("Joe's Pizza")).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /^Menu/ })).toBeOnTheScreen();
  });

  it('opens the inbox with push, so Back returns to Manage', async () => {
    await renderScreen();
    await fireEvent.press(await requestsRow());
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith('/seller/requests');
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('sits after Change address and before Menu', async () => {
    await renderScreen();
    const change = await screen.findByRole('button', { name: 'Change address' });
    const row = await requestsRow();
    const menu = await screen.findByRole('button', { name: /^Menu/ });
    const buttons = screen.getAllByRole('button');
    expect(buttons.indexOf(row)).toBeGreaterThan(buttons.indexOf(change));
    expect(buttons.indexOf(menu)).toBeGreaterThan(buttons.indexOf(row));
  });

  it('shows the row to a homemade seller too', async () => {
    (getMyBusiness as unknown as jest.Mock).mockResolvedValue({
      ...restaurant,
      type: 'homemade',
      accepts_table_requests: false,
      public_address: null,
    });
    await renderScreen();
    expect(await requestsRow()).toBeOnTheScreen();
  });

  it('reads the count again every 30 seconds, because nothing pushes it yet', async () => {
    jest.useFakeTimers();
    await renderScreen();
    await waitFor(async () =>
      expect((await requestsRow()).props.accessibilityLabel).toBe('Requests: 3 waiting'),
    );
    countMock.mockResolvedValue({ server_now: NOW, waiting: 4 });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PENDING_POLL_MS + 100);
    });
    await waitFor(async () =>
      expect((await requestsRow()).props.accessibilityLabel).toBe('Requests: 4 waiting'),
    );
  });
});
