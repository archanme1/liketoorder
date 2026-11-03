import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { queryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';

// Spec 05 Decision 14: real app/ routes, supabase mocked (the spec 03 routing.test.tsx pattern).
// While the business query loads, the root Stack must stay mounted: the previous screen stays in
// the back stack and nothing remounts. The redirect happens only after the data loads.

const mockProfileMounts = jest.fn();
const mockProfileUnmounts = jest.fn();

// Wraps the real Profile screen to count mounts and unmounts (a remount shows up in both).
jest.mock('@/features/profile/components/ProfileScreen', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const React = require('react');
  const actual = jest.requireActual('@/features/profile/components/ProfileScreen');
  /* eslint-enable @typescript-eslint/no-require-imports */
  function CountedProfileScreen(props: object) {
    React.useEffect(() => {
      mockProfileMounts();
      return () => {
        mockProfileUnmounts();
      };
    }, []);
    return React.createElement(actual.ProfileScreen, props);
  }
  return { ...actual, ProfileScreen: CountedProfileScreen };
});

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      getSession: jest.fn(),
      signOut: jest.fn(async () => ({ error: null })),
    },
    from: jest.fn(),
    rpc: jest.fn(),
    functions: { invoke: jest.fn() },
  },
}));

const mocked = supabase as unknown as {
  auth: { getSession: jest.Mock };
  from: jest.Mock;
  rpc: jest.Mock;
  functions: { invoke: jest.Mock };
};

const session = { access_token: 't', refresh_token: 'r', user: { id: 'u1', email: 'a@b.com' } };
const completeProfile = {
  id: 'u1',
  username: 'archan',
  display_name: 'Archan Me',
  bio: '',
  city: '',
  is_seller: false,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

const businessView = {
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

const cuisineRows = [
  { code: 'IT', kind: 'country', name: 'Italy', flag: '🇮🇹', icon: null, sort_order: 100 },
];

type RpcResult = { data: unknown; error: unknown };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// What the mocked database currently holds; tests change it to simulate a refetch.
let profile: typeof completeProfile;
let business: typeof businessView | null;
let pendingBusiness: Promise<RpcResult> | null;

type CuisinesBuilder = {
  select: () => CuisinesBuilder;
  order: () => CuisinesBuilder;
  then: (resolve: (value: RpcResult) => unknown) => Promise<unknown>;
};
type ProfilesBuilder = {
  select: jest.Mock;
  eq: jest.Mock;
  maybeSingle: jest.Mock;
};

function mockTables() {
  mocked.from.mockImplementation((table: string) => {
    if (table === 'cuisines') {
      const cuisines: CuisinesBuilder = {
        select: () => cuisines,
        order: () => cuisines,
        then: (resolve: (value: RpcResult) => unknown) =>
          Promise.resolve({ data: cuisineRows, error: null }).then(resolve),
      };
      return cuisines;
    }
    const profiles: ProfilesBuilder = {
      select: jest.fn(() => profiles),
      eq: jest.fn(() => profiles),
      maybeSingle: jest.fn(async () => ({ data: profile, error: null })),
    };
    return profiles;
  });
  mocked.rpc.mockImplementation((name: string, args?: { p_on?: boolean }) => {
    if (name === 'get_my_business') {
      return pendingBusiness ?? Promise.resolve({ data: business, error: null });
    }
    if (name === 'set_seller_mode') {
      const on = args?.p_on === true;
      profile = { ...profile, is_seller: on };
      if (business) business = { ...business, is_listed: on };
      return Promise.resolve({ data: null, error: null });
    }
    return Promise.resolve({ data: null, error: { code: 'XX000', message: 'unexpected rpc' } });
  });
}

const appQueryDefaults = queryClient.getDefaultOptions();

describe('seller route guards (Decision 14)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    queryClient.clear();
    await AsyncStorage.clear();
    mocked.auth.getSession.mockResolvedValue({ data: { session } });
    profile = { ...completeProfile };
    business = null;
    pendingBusiness = null;
    mockTables();
  });

  afterEach(() => {
    queryClient.setDefaultOptions(appQueryDefaults);
  });

  describe('no business', () => {
    it('keeps the Stack mounted while loading, then redirects /seller/edit to onboarding; Back returns to Profile', async () => {
      const pending = deferred<RpcResult>();
      pendingBusiness = pending.promise;

      await renderRouter('./app', { initialUrl: '/profile' });
      expect(await screen.findByText('@archan')).toBeTruthy();
      expect(mockProfileMounts).toHaveBeenCalledTimes(1);

      await act(async () => {
        router.push('/seller/edit');
      });

      // Loading: the seller screen shows its skeleton on top of the untouched Profile screen.
      expect((await screen.findAllByTestId('seller-skeleton')).length).toBeGreaterThan(0);
      expect(screen).toHavePathname('/seller/edit');
      expect(router.canGoBack()).toBe(true);
      expect(mockProfileMounts).toHaveBeenCalledTimes(1);
      expect(mockProfileUnmounts).not.toHaveBeenCalled();

      // The data arrives: no business, so edit sends the user to onboarding.
      pendingBusiness = null;
      await act(async () => {
        pending.resolve({ data: null, error: null });
      });
      await waitFor(() => expect(screen).toHavePathname('/seller/onboarding'));
      expect(await screen.findByRole('header', { name: 'Start selling' })).toBeTruthy();
      expect(mockProfileMounts).toHaveBeenCalledTimes(1);
      expect(mockProfileUnmounts).not.toHaveBeenCalled();

      // Back still returns to Profile, without remounting it.
      expect(router.canGoBack()).toBe(true);
      await act(async () => {
        router.back();
      });
      await waitFor(() => expect(screen).toHavePathname('/profile'));
      expect(await screen.findByText('@archan')).toBeTruthy();
      expect(mockProfileMounts).toHaveBeenCalledTimes(1);
      expect(mockProfileUnmounts).not.toHaveBeenCalled();
    });

    it('keeps the Stack mounted while /seller/address loads, then redirects to onboarding', async () => {
      const pending = deferred<RpcResult>();
      pendingBusiness = pending.promise;

      await renderRouter('./app', { initialUrl: '/profile' });
      expect(await screen.findByText('@archan')).toBeTruthy();
      await act(async () => {
        router.push('/seller/address');
      });

      expect((await screen.findAllByTestId('seller-skeleton')).length).toBeGreaterThan(0);
      expect(screen).toHavePathname('/seller/address');
      expect(router.canGoBack()).toBe(true);
      expect(mockProfileMounts).toHaveBeenCalledTimes(1);
      expect(mockProfileUnmounts).not.toHaveBeenCalled();

      pendingBusiness = null;
      await act(async () => {
        pending.resolve({ data: null, error: null });
      });
      await waitFor(() => expect(screen).toHavePathname('/seller/onboarding'));
      expect(mockProfileUnmounts).not.toHaveBeenCalled();
    });

    it('opening /seller/edit directly redirects to onboarding once the business has loaded', async () => {
      await renderRouter('./app', { initialUrl: '/seller/edit' });
      await waitFor(() => expect(screen).toHavePathname('/seller/onboarding'));
      expect(await screen.findByRole('header', { name: 'Start selling' })).toBeTruthy();
    });

    it('stays on /seller/onboarding when there is no business', async () => {
      await renderRouter('./app', { initialUrl: '/seller/onboarding' });
      expect(await screen.findByRole('header', { name: 'Start selling' })).toBeTruthy();
      expect(screen).toHavePathname('/seller/onboarding');
    });
  });

  describe('has a business, seller mode on', () => {
    beforeEach(() => {
      profile = { ...completeProfile, is_seller: true };
      business = { ...businessView };
    });

    it('keeps the Stack mounted while /seller/onboarding loads, then redirects to /manage', async () => {
      const pending = deferred<RpcResult>();
      pendingBusiness = pending.promise;

      await renderRouter('./app', { initialUrl: '/profile' });
      expect(await screen.findByText('@archan')).toBeTruthy();
      expect(mockProfileMounts).toHaveBeenCalledTimes(1);

      await act(async () => {
        router.push('/seller/onboarding');
      });

      expect((await screen.findAllByTestId('seller-skeleton')).length).toBeGreaterThan(0);
      expect(screen).toHavePathname('/seller/onboarding');
      expect(router.canGoBack()).toBe(true);
      expect(mockProfileMounts).toHaveBeenCalledTimes(1);
      expect(mockProfileUnmounts).not.toHaveBeenCalled();

      pendingBusiness = null;
      await act(async () => {
        pending.resolve({ data: businessView, error: null });
      });
      await waitFor(() => expect(screen).toHavePathname('/manage'));
      expect(await screen.findByRole('header', { name: 'Manage Business' })).toBeTruthy();
    });

    it('lets a seller with a business open /seller/edit', async () => {
      await renderRouter('./app', { initialUrl: '/seller/edit' });
      expect(await screen.findByLabelText('Business name')).toBeTruthy();
      expect(screen).toHavePathname('/seller/edit');
    });

    it('lets a seller with a business open /seller/address', async () => {
      await renderRouter('./app', { initialUrl: '/seller/address' });
      expect(await screen.findByLabelText('Address')).toBeTruthy();
      expect(screen).toHavePathname('/seller/address');
    });

    it('shows Manage Business at /manage with the Live status', async () => {
      await renderRouter('./app', { initialUrl: '/manage' });
      expect(await screen.findByRole('header', { name: 'Manage Business' })).toBeTruthy();
      expect(await screen.findByLabelText('Listing status: Live')).toBeTruthy();
    });
  });

  describe('has a business, seller mode off', () => {
    beforeEach(() => {
      profile = { ...completeProfile, is_seller: false };
      business = { ...businessView, is_listed: false };
    });

    it('redirects /seller/onboarding to /profile', async () => {
      await renderRouter('./app', { initialUrl: '/profile' });
      expect(await screen.findByText('@archan')).toBeTruthy();

      await act(async () => {
        router.push('/seller/onboarding');
      });

      await waitFor(() => expect(screen).toHavePathname('/profile'));
      expect(screen.queryByText('Step 1 of 2')).toBeNull();
      expect(screen.queryByRole('header', { name: 'Start selling' })).toBeNull();
    });

    it('opening /seller/onboarding directly lands on /profile', async () => {
      await renderRouter('./app', { initialUrl: '/seller/onboarding' });
      expect(await screen.findByText('@archan')).toBeTruthy();
      expect(screen).toHavePathname('/profile');
    });

    it('lets the owner open /seller/edit even with seller mode off', async () => {
      await renderRouter('./app', { initialUrl: '/seller/edit' });
      expect(await screen.findByLabelText('Business name')).toBeTruthy();
      expect(screen).toHavePathname('/seller/edit');
    });
  });

  describe('seller mode switch on the Profile tab', () => {
    it('shows Start selling to a user with no business and opens onboarding', async () => {
      await renderRouter('./app', { initialUrl: '/profile' });
      await fireEvent.press(await screen.findByRole('button', { name: 'Start selling' }));
      await waitFor(() => expect(screen).toHavePathname('/seller/onboarding'));
      expect(await screen.findByText('Step 1 of 2')).toBeTruthy();
    });

    it('hides the Manage tab after the seller switches seller mode off', async () => {
      profile = { ...completeProfile, is_seller: true };
      business = { ...businessView };

      await renderRouter('./app', { initialUrl: '/profile' });
      expect(await screen.findByLabelText('Manage tab')).toBeTruthy();
      const sw = await screen.findByRole('switch', { name: 'Seller mode' });

      await fireEvent(sw, 'valueChange', false);
      if (!mocked.rpc.mock.calls.some((call: unknown[]) => call[0] === 'set_seller_mode')) {
        await fireEvent.press(screen.getByRole('switch', { name: 'Seller mode' }));
      }

      await waitFor(() =>
        expect(mocked.rpc).toHaveBeenCalledWith('set_seller_mode', { p_on: false }),
      );
      await waitFor(() => expect(screen.queryByLabelText('Manage tab')).toBeNull());
    });
  });
});
