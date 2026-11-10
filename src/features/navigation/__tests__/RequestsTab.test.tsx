import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, waitFor } from '@testing-library/react-native';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { REQUEST_ID, makeRequest } from '@/features/requests/__fixtures__/requests';
import { makeSellerRequest } from '@/features/requests/__fixtures__/sellerRequests';
import { clearStatusMemory } from '@/features/requests/statusMemory';
import { myProfileKey } from '@/features/profile/hooks/useMyProfile';
import { queryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';

// The Requests tab inside the real app/ routes (root layout + tab bar), with supabase mocked by
// function name. The maps are stand-ins: these tests are about tabs, routing and the badge.
jest.mock('@/features/map/components/RestaurantMapScreen', () => ({
  RestaurantMapScreen: () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { ComingSoon } = require('@/features/navigation/components/ComingSoon');
    /* eslint-enable @typescript-eslint/no-require-imports */
    return <ComingSoon title="Restaurants" message="The restaurant map is coming soon." />;
  },
}));
jest.mock('@/features/map/components/HomemadeMapScreen', () => ({
  HomemadeMapScreen: () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { ComingSoon } = require('@/features/navigation/components/ComingSoon');
    /* eslint-enable @typescript-eslint/no-require-imports */
    return <ComingSoon title="Homemade" message="Homemade food near you is coming soon." />;
  },
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      getSession: jest.fn(),
      signOut: jest.fn(async () => ({ error: null })),
    },
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

const db = supabase as unknown as {
  auth: { getSession: jest.Mock };
  from: jest.Mock;
  rpc: jest.Mock;
};
const session = { access_token: 't', refresh_token: 'r', user: { id: 'u1', email: 'a@b.com' } };
const profile = {
  id: 'u1',
  username: 'archan',
  display_name: 'Archan Me',
  bio: '',
  city: '',
  is_seller: false,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};
const business = {
  id: 'b1',
  type: 'restaurant',
  name: "Archan's Kitchen",
  cuisine_code: 'italian',
  accepts_table_requests: false,
  map_lat: null,
  map_lng: null,
  public_address: null,
  is_listed: true,
  currency_code: 'CAD',
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  location: null,
};
const NOW = '2026-11-08T17:00:00Z';

type World = {
  profile: typeof profile;
  business: typeof business | null;
  sent: ReturnType<typeof makeRequest>[];
  inbox: ReturnType<typeof makeSellerRequest>[];
  waiting: number;
};
let world: World;

type QueryBuilder = { select: jest.Mock; eq: jest.Mock; maybeSingle: jest.Mock };

function installDatabase() {
  const builder: QueryBuilder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => ({ data: world.profile, error: null })),
  };
  db.from.mockReturnValue(builder);
  db.rpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => {
    switch (name) {
      case 'get_my_business':
        return { data: world.business, error: null };
      case 'list_my_requests':
        return { data: { server_now: NOW, requests: world.sent, next_cursor: null }, error: null };
      case 'get_my_pickup_request':
        return {
          data: {
            server_now: NOW,
            request: world.sent.find((r) => r.id === args?.p_request_id) ?? null,
          },
          error: null,
        };
      case 'list_business_requests':
        return {
          data: { server_now: NOW, requests: world.inbox, next_cursor: null },
          error: null,
        };
      case 'get_business_request':
        return {
          data: {
            server_now: NOW,
            request: world.inbox.find((r) => r.id === args?.p_request_id) ?? null,
          },
          error: null,
        };
      case 'count_waiting_requests':
        return { data: { server_now: NOW, waiting: world.waiting }, error: null };
      case 'respond_to_request':
        return {
          data: {
            ...world.inbox[0],
            status: 'accepted',
            display_status: 'accepted',
            responded_at: NOW,
          },
          error: null,
        };
      default:
        return { data: null, error: { code: 'P0001', message: 'unknown' } };
    }
  });
}

// renderRouter runs on fake timers, so settle with promises only (no setImmediate / setTimeout).
async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

// The tab buttons in bar order, by their spoken label ("Requests tab, 3 new" keeps its number).
const tabLabels = () =>
  screen
    .getAllByLabelText(/^(Restaurants|Homemade|Requests|Manage|Profile) tab/)
    .map((tab) => String(tab.props.accessibilityLabel));

beforeEach(async () => {
  jest.clearAllMocks();
  queryClient.clear();
  clearStatusMemory();
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await AsyncStorage.clear();
  world = { profile: { ...profile }, business: null, sent: [], inbox: [], waiting: 0 };
  db.auth.getSession.mockResolvedValue({ data: { session } });
  installDatabase();
});

describe('guest', () => {
  beforeEach(() => {
    db.auth.getSession.mockResolvedValue({ data: { session: null } });
  });

  it('has no Requests tab and never asks for requests', async () => {
    await renderRouter('./app', { initialUrl: '/restaurants' });
    await screen.findByLabelText('Profile tab');
    expect(screen.queryByLabelText(/^Requests tab/)).toBeNull();
    await act(async () => {});
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('sends a link to /requests to the Restaurants tab', async () => {
    await renderRouter('./app', { initialUrl: '/requests' });
    expect(await screen.findByText('The restaurant map is coming soon.')).toBeTruthy();
    expect(screen).toHavePathname('/restaurants');
  });
});

describe('a customer (seller mode off)', () => {
  it('has Restaurants, Homemade, Requests, Profile in that order, and no Manage', async () => {
    await renderRouter('./app', { initialUrl: '/restaurants' });
    await screen.findByLabelText('Requests tab');
    expect(tabLabels()).toEqual(['Restaurants tab', 'Homemade tab', 'Requests tab', 'Profile tab']);
  });

  it('opens the Sent list from the Requests tab, with no switches', async () => {
    world.sent = [makeRequest()];
    await renderRouter('./app', { initialUrl: '/restaurants' });
    await fireEvent.press(await screen.findByLabelText('Requests tab'));
    expect(await screen.findByRole('button', { name: /Joe's Pizza/ })).toBeTruthy();
    expect(screen).toHavePathname('/requests');
    expect(screen.getByLabelText('Requests tab')).toBeSelected();
    expect(screen.queryByLabelText('Requests')).toBeNull();
  });

  it('keeps /requests working as a link: it shows the same Sent list', async () => {
    world.sent = [makeRequest()];
    await renderRouter('./app', { initialUrl: '/requests' });
    expect(await screen.findByRole('button', { name: /Joe's Pizza/ })).toBeTruthy();
    expect(screen).toHavePathname('/requests');
  });

  it('keeps /requests/<id> working: the request detail', async () => {
    world.sent = [makeRequest()];
    await renderRouter('./app', { initialUrl: `/requests/${REQUEST_ID}` });
    expect(await screen.findByText("Joe's Pizza")).toBeTruthy();
    expect(screen).toHavePathname(`/requests/${REQUEST_ID}`);
  });

  it('opens a request from the list and returns to the tab', async () => {
    world.sent = [makeRequest()];
    await renderRouter('./app', { initialUrl: '/requests' });
    await fireEvent.press(await screen.findByRole('button', { name: /Joe's Pizza/ }));
    await waitFor(() => expect(screen).toHavePathname(`/requests/${REQUEST_ID}`));
  });

  it('shows the number on the Requests tab, spoken in its label, once a request changed', async () => {
    world.sent = [makeRequest()];
    await renderRouter('./app', { initialUrl: '/profile' });
    await screen.findByLabelText('Requests tab');
    await settle();
    // The seller answers while the person is on another tab.
    world.sent = [makeRequest({ status: 'accepted', display_status: 'accepted' })];
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['requests', 'mine'] });
    });
    expect(await screen.findByLabelText('Requests tab, 1 new')).toBeTruthy();
    // The number itself is hidden from the screen reader so it is not read twice.
    const badges = screen.getAllByTestId('tab-badge', { includeHiddenElements: true });
    expect(badges.length).toBeGreaterThan(0);
    for (const badge of badges) expect(badge.props.accessibilityElementsHidden).toBe(true);
  });

  it('shows no number for a first sight (the baseline), even for answered requests', async () => {
    world.sent = [makeRequest({ status: 'declined', display_status: 'declined' })];
    await renderRouter('./app', { initialUrl: '/profile' });
    await screen.findByLabelText('Requests tab');
    await settle();
    expect(screen.queryByTestId('tab-badge', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByLabelText('Requests tab')).toBeTruthy();
  });
});

describe('a seller (seller mode on)', () => {
  beforeEach(() => {
    world.profile = { ...profile, is_seller: true };
    world.business = business;
    world.waiting = 2;
    world.inbox = [makeSellerRequest({ id: REQUEST_ID, customer_name: 'Sam Rivera' })];
  });

  it('lands on Requests from the home route, with Requests, Manage, Profile in that order', async () => {
    await renderRouter('./app', { initialUrl: '/restaurants' });
    await waitFor(() => expect(screen).toHavePathname('/requests'));
    await waitFor(() =>
      expect(tabLabels()).toEqual([
        expect.stringMatching(/^Requests tab/),
        'Manage tab',
        'Profile tab',
      ]),
    );
    expect(screen.queryByLabelText('Restaurants tab')).toBeNull();
    expect(screen.queryByLabelText('Homemade tab')).toBeNull();
  });

  it('sends a direct link to a hidden map tab to Requests', async () => {
    await renderRouter('./app', { initialUrl: '/homemade' });
    await waitFor(() => expect(screen).toHavePathname('/requests'));
    expect(screen.queryByText('Homemade food near you is coming soon.')).toBeNull();
  });

  it('opens on Received with the waiting number on the tab and on the switch', async () => {
    await renderRouter('./app', { initialUrl: '/requests' });
    expect(
      await screen.findByRole('radio', { name: 'Received, 2 need you, selected' }),
    ).toBeTruthy();
    expect(await screen.findByLabelText('Requests tab, 2 new')).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Request from Sam Rivera/ })).toBeTruthy();
  });

  it('keeps /seller/requests and /seller/requests/<id> working', async () => {
    await renderRouter('./app', { initialUrl: '/seller/requests' });
    expect(await screen.findByRole('button', { name: /Request from Sam Rivera/ })).toBeTruthy();
    expect(screen).toHavePathname('/seller/requests');
  });

  it('opens a received request from the tab', async () => {
    await renderRouter('./app', { initialUrl: '/requests' });
    await fireEvent.press(await screen.findByRole('button', { name: /Request from Sam Rivera/ }));
    await waitFor(() => expect(screen).toHavePathname(`/seller/requests/${REQUEST_ID}`));
    expect(await screen.findByRole('button', { name: /^Accept request/ })).toBeTruthy();
  });
});

describe('a business owner with seller mode off', () => {
  beforeEach(() => {
    world.business = business;
    world.waiting = 1;
    world.inbox = [makeSellerRequest({ id: REQUEST_ID, customer_name: 'Sam Rivera' })];
    world.sent = [makeRequest({ id: '33333333-3333-4333-8333-333333333333' })];
  });

  it('keeps all four tabs and opens Requests on Sent, with Received one tap away', async () => {
    await renderRouter('./app', { initialUrl: '/requests' });
    expect(await screen.findByRole('radio', { name: /^Sent, selected/ })).toBeTruthy();
    expect(tabLabels()).toEqual([
      'Restaurants tab',
      'Homemade tab',
      expect.stringMatching(/^Requests tab/),
      'Profile tab',
    ]);
    expect(await screen.findByLabelText('Requests tab, 1 new')).toBeTruthy();
  });

  it('can open Received and accept a waiting request', async () => {
    await renderRouter('./app', { initialUrl: '/requests' });
    await fireEvent.press(await screen.findByRole('radio', { name: /^Received/ }));
    await fireEvent.press(await screen.findByRole('button', { name: /Request from Sam Rivera/ }));
    await fireEvent.press(await screen.findByRole('button', { name: /^Accept request/ }));
    await fireEvent.press(await screen.findByRole('button', { name: /^Yes, accept request/ }));
    await waitFor(() =>
      expect(db.rpc).toHaveBeenCalledWith('respond_to_request', {
        p_request_id: REQUEST_ID,
        p_decision: 'accepted',
      }),
    );
  });
});

describe('seller mode changes while the app is open', () => {
  beforeEach(() => {
    world.business = business;
  });

  it('changes the tab bar at once when is_seller flips on, and back', async () => {
    await renderRouter('./app', { initialUrl: '/profile' });
    await screen.findByLabelText('Restaurants tab');

    world.profile = { ...profile, is_seller: true };
    await act(async () => {
      queryClient.setQueryData(myProfileKey, world.profile);
    });
    await waitFor(() => expect(screen.queryByLabelText('Restaurants tab')).toBeNull());
    expect(await screen.findByLabelText('Manage tab')).toBeTruthy();
    expect(screen.getByLabelText(/^Requests tab/)).toBeTruthy();

    world.profile = { ...profile, is_seller: false };
    await act(async () => {
      queryClient.setQueryData(myProfileKey, world.profile);
    });
    expect(await screen.findByLabelText('Restaurants tab')).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText('Manage tab')).toBeNull());
  });
});

describe('Profile', () => {
  it('no longer has a My requests row', async () => {
    await renderRouter('./app', { initialUrl: '/profile' });
    await screen.findByRole('button', { name: 'Edit profile' });
    expect(screen.queryByRole('button', { name: 'My requests' })).toBeNull();
  });
});
