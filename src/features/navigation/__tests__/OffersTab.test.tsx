import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, waitFor } from '@testing-library/react-native';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { listCuisines } from '@/features/cuisines/api';
import { signedUrls } from '@/features/media/api';
import {
  createOffersServer,
  makeOffer,
  type OffersServer,
} from '@/features/promotions/__fixtures__/offers';
import { setLocation, VIETNAM } from '@/features/promotions/__fixtures__/offersScreen';
import { queryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';

// Spec 16: the Offers tab inside the real app/ routes (root layout + tab bar), with supabase
// mocked. The maps are stand-ins that show the place an Offers card asked them to open.
jest.mock('@/features/map/components/RestaurantMapScreen', () => ({
  RestaurantMapScreen: ({
    offerTarget,
  }: {
    offerTarget?: { business: string; lat: number } | null;
  }) => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { Text } = require('react-native');
    /* eslint-enable @typescript-eslint/no-require-imports */
    return (
      <Text>{`Restaurants map${offerTarget ? `, opening ${offerTarget.business} at ${offerTarget.lat}` : ''}`}</Text>
    );
  },
}));
jest.mock('@/features/map/components/HomemadeMapScreen', () => ({
  HomemadeMapScreen: ({ offerTarget }: { offerTarget?: { business: string } | null }) => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { Text } = require('react-native');
    /* eslint-enable @typescript-eslint/no-require-imports */
    return <Text>{`Homemade map${offerTarget ? `, opening ${offerTarget.business}` : ''}`}</Text>;
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
jest.mock('@/features/cuisines/api', () => ({
  ...jest.requireActual('@/features/cuisines/api'),
  listCuisines: jest.fn(),
}));
jest.mock('@/features/media/api', () => ({
  ...jest.requireActual('@/features/media/api'),
  signedUrls: jest.fn(),
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
const COOK_ID = '00000000-0000-4000-8000-000000001702';

let current: typeof profile;
let server: OffersServer;

const tabLabels = () =>
  screen
    .getAllByLabelText(/^(Restaurants|Homemade|Offers|Requests|Manage|Profile) tab/)
    .map((tab) => String(tab.props.accessibilityLabel));

beforeEach(async () => {
  jest.clearAllMocks();
  queryClient.clear();
  await AsyncStorage.clear();
  current = { ...profile };
  type QueryBuilder = {
    select: jest.Mock;
    eq: jest.Mock;
    order: jest.Mock;
    maybeSingle: jest.Mock;
  };
  const builder: QueryBuilder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    order: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => ({ data: current, error: null })),
  };
  db.from.mockReturnValue(builder);
  server = createOffersServer({
    rows: [
      makeOffer(),
      makeOffer({ business_id: COOK_ID, name: 'Amara Jollof', type: 'homemade', lat: 43.9013 }),
    ],
  });
  db.rpc.mockImplementation((name: string, args?: Record<string, unknown>) =>
    name === 'list_offers_near'
      ? server.rpc(name, args)
      : Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'not in this test' } }),
  );
  jest.mocked(listCuisines).mockResolvedValue([VIETNAM]);
  jest.mocked(signedUrls).mockResolvedValue({});
  setLocation('granted');
});

describe('guest', () => {
  beforeEach(() => {
    db.auth.getSession.mockResolvedValue({ data: { session: null } });
  });

  it('shows Restaurants, Homemade, Offers and Profile, in that order', async () => {
    await renderRouter('./app', { initialUrl: '/restaurants' });
    await screen.findByLabelText('Offers tab');
    expect(tabLabels()).toEqual(['Restaurants tab', 'Homemade tab', 'Offers tab', 'Profile tab']);
  });

  it('opens Offers from its tab, with its label and the list', async () => {
    await renderRouter('./app', { initialUrl: '/restaurants' });
    await fireEvent.press(await screen.findByLabelText('Offers tab'));
    expect(screen).toHavePathname('/offers');
    expect(await screen.findByRole('header', { name: 'Offers' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Offers tab')).toBeSelected();
    expect(
      await screen.findByRole('button', { name: /^Simcoe Street Pho, .*, sponsored$/ }),
    ).toBeOnTheScreen();
  });

  it('a restaurant card opens the Restaurants tab on that place', async () => {
    await renderRouter('./app', { initialUrl: '/offers' });
    await fireEvent.press(
      await screen.findByRole('button', { name: /^Simcoe Street Pho, .*, sponsored$/ }),
    );
    await waitFor(() => expect(screen).toHavePathname('/restaurants'));
    expect(
      await screen.findByText(`Restaurants map, opening ${makeOffer().business_id} at 43.8971`),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Restaurants tab')).toBeSelected();
  });

  it('a home cook card opens the Homemade tab on that cook', async () => {
    await renderRouter('./app', { initialUrl: '/offers' });
    await fireEvent.press(
      await screen.findByRole('button', { name: /^Amara Jollof, .*, sponsored$/ }),
    );
    await waitFor(() => expect(screen).toHavePathname('/homemade'));
    expect(await screen.findByText(`Homemade map, opening ${COOK_ID}`)).toBeOnTheScreen();
  });

  it('Browse the map opens the Restaurants tab', async () => {
    server.rows = [];
    await renderRouter('./app', { initialUrl: '/offers' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Browse the map' }));
    await waitFor(() => expect(screen).toHavePathname('/restaurants'));
    expect(await screen.findByText('Restaurants map')).toBeOnTheScreen();
  });
});

// Archan's Simulator screenshot showed "About 5 km" on Offers. The default is About 15 km on a
// fresh open; a choice is kept (in memory only) while the tab stays mounted, which it does across
// tab switches, so an earlier "About 5 km" still shows when Offers is opened again.
describe('the default distance', () => {
  beforeEach(() => {
    db.auth.getSession.mockResolvedValue({ data: { session: null } });
  });

  it('is About 15 km on a fresh open', async () => {
    await renderRouter('./app', { initialUrl: '/offers' });
    await waitFor(() => expect(server.calls).toHaveLength(1));
    expect(server.calls[0]).toMatchObject({ p_distance_km: 15 });
    expect(screen.getByTestId('filters-button').props.accessibilityLabel).toBe('Filters');
  });

  it('keeps a chosen distance across a tab switch (the tab stays mounted)', async () => {
    await renderRouter('./app', { initialUrl: '/offers' });
    await waitFor(() => expect(server.calls).toHaveLength(1));
    await fireEvent.press(screen.getByTestId('filters-button'));
    await fireEvent.press(screen.getByRole('radio', { name: 'About 5 km' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Show offers' }));
    await waitFor(() => expect(server.calls).toHaveLength(2));
    await fireEvent.press(screen.getByLabelText('Restaurants tab'));
    await screen.findByText('Restaurants map');
    await fireEvent.press(screen.getByLabelText('Offers tab'));
    await waitFor(() =>
      expect(screen.getByTestId('filters-button').props.accessibilityLabel).toBe(
        'Filters, 1 applied',
      ),
    );
    expect(screen.getByText('About 5 km')).toBeOnTheScreen();
  });
});

describe('signed in, seller mode off', () => {
  beforeEach(() => {
    db.auth.getSession.mockResolvedValue({ data: { session } });
  });

  it('shows Restaurants, Homemade, Offers, Requests and Profile, in that order', async () => {
    await renderRouter('./app', { initialUrl: '/restaurants' });
    await screen.findByLabelText(/^Requests tab/);
    expect(tabLabels()).toEqual([
      'Restaurants tab',
      'Homemade tab',
      'Offers tab',
      expect.stringMatching(/^Requests tab/),
      'Profile tab',
    ]);
  });
});

describe('signed in, seller mode on', () => {
  beforeEach(() => {
    db.auth.getSession.mockResolvedValue({ data: { session } });
    current = { ...profile, is_seller: true };
  });

  it('hides Offers with the maps, and sends /offers to Requests', async () => {
    await renderRouter('./app', { initialUrl: '/offers' });
    await waitFor(() => expect(screen).toHavePathname('/requests'));
    await screen.findByLabelText('Manage tab');
    expect(screen.queryByLabelText('Offers tab')).toBeNull();
    await act(async () => {});
    expect(server.calls).toHaveLength(0);
  });
});
