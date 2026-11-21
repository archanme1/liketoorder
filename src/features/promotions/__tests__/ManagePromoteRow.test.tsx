import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';

import { AuthProvider } from '@/features/auth/components/AuthProvider';
import { listCuisines } from '@/features/cuisines/api';
import { resetModuleMocks, testClientOptions } from '@/features/food-log/__fixtures__/foodLog';
import { getMenu } from '@/features/menu/api';
import * as profileApi from '@/features/profile/api';
import { getMyBusiness } from '@/features/sellers/api';
import { ManageBusinessScreen } from '@/features/sellers/components/ManageBusinessScreen';
import type { MyBusiness } from '@/features/sellers/schema';
import { supabase } from '@/lib/supabase';

// Spec 16: the Promote row on Manage Business. Same setup as ManageBusinessScreen.test.tsx. The row
// is static (no query), so the older Manage tests need no change.
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
  supabase: { auth: { onAuthStateChange: jest.fn(), getSession: jest.fn() }, rpc: jest.fn() },
}));
jest.mock('@/features/profile/api', () => ({
  ...jest.requireActual('@/features/profile/api'),
  getMyProfile: jest.fn(),
}));
jest.mock('@/features/cuisines/api', () => ({
  ...jest.requireActual('@/features/cuisines/api'),
  listCuisines: jest.fn(),
}));
jest.mock('@/features/sellers/api', () => ({
  ...jest.requireActual('@/features/sellers/api'),
  getMyBusiness: jest.fn(),
}));
jest.mock('@/features/menu/api', () => ({
  ...jest.requireActual('@/features/menu/api'),
  getMenu: jest.fn(),
}));

const auth = supabase.auth as unknown as Record<string, jest.Mock>;
const rpc = jest.mocked(supabase.rpc) as unknown as jest.Mock;

const session = { access_token: 't', refresh_token: 'r', user: { id: 'u1' } };
const profile: profileApi.Profile = {
  id: 'u1',
  username: 'seller',
  display_name: 'Seller One',
  bio: '',
  city: '',
  is_seller: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const restaurant: MyBusiness = {
  id: 'b1',
  type: 'restaurant',
  name: 'Pho Corner',
  cuisine_code: 'VN',
  accepts_table_requests: true,
  map_lat: 43.9,
  map_lng: -78.86,
  public_address: '1 Main St, Oshawa, ON',
  is_listed: true,
  currency_code: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  location: { formatted_address: '1 Main St, Oshawa, ON', lat: 43.9, lng: -78.86 },
};
const homemade: MyBusiness = {
  ...restaurant,
  id: 'b2',
  type: 'homemade',
  name: 'Home Kitchen',
  accepts_table_requests: false,
  public_address: null,
};

let client: QueryClient;

beforeEach(() => {
  jest.mocked(getMyBusiness).mockResolvedValue(restaurant);
  jest.mocked(profileApi.getMyProfile).mockResolvedValue(profile);
  jest.mocked(getMenu).mockResolvedValue({ items: [], photos: [] });
  jest.mocked(listCuisines).mockResolvedValue([
    {
      code: 'VN',
      kind: 'country',
      name: 'Vietnam',
      flag: String.fromCodePoint(0x1f1fb, 0x1f1f3),
      icon: null,
      sort_order: 100,
    },
  ]);
  rpc.mockResolvedValue({ data: { waiting: 0 }, error: null });
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  auth.getSession.mockResolvedValue({ data: { session } });
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
  resetModuleMocks(
    '@/features/sellers/api',
    '@/features/profile/api',
    '@/features/menu/api',
    '@/features/cuisines/api',
  );
});

async function renderManage() {
  client = new QueryClient(testClientOptions());
  await render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <ManageBusinessScreen />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('Manage Business: the Promote row', () => {
  it('opens the Promote screen with one push', async () => {
    await renderManage();
    await fireEvent.press(await screen.findByRole('button', { name: 'Promote your business' }));
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith('/seller/promote');
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('is shown to a home cook too', async () => {
    jest.mocked(getMyBusiness).mockResolvedValue(homemade);
    await renderManage();
    expect(await screen.findByRole('button', { name: 'Promote your business' })).toBeTruthy();
  });

  it('comes after the Menu and Photos rows and tells what it opens', async () => {
    await renderManage();
    const promote = await screen.findByRole('button', { name: 'Promote your business' });
    const photos = screen.getByRole('button', { name: /^Photos/ });
    const buttons = screen.getAllByRole('button');
    expect(buttons.indexOf(promote)).toBeGreaterThan(buttons.indexOf(photos));
    expect(promote.props.accessibilityHint).toBe('Opens your promotion');
  });

  it('is static: Manage never asks for the promotion', async () => {
    await renderManage();
    await screen.findByRole('button', { name: 'Promote your business' });
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain('get_my_promotion');
  });

  it('is not shown before there is a business', async () => {
    jest.mocked(getMyBusiness).mockResolvedValue(null);
    await renderManage();
    expect(
      await screen.findByText(`You don${String.fromCodePoint(0x2019)}t have a business yet.`),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Promote your business' })).toBeNull();
  });
});
