import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, waitFor, within } from '@testing-library/react-native';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { myProfileKey } from '@/features/profile/hooks/useMyProfile';
import { queryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';

// Renders the real app/ routes (root layout + tab bar) with supabase mocked.

// These tests cover routing and the tab bar, not the map (spec 07 has its own tests). Keep the
// Restaurants tab on a stand-in screen so they don't depend on native map modules or keys.
jest.mock('@/features/map/components/RestaurantMapScreen', () => ({
  RestaurantMapScreen: () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { ComingSoon } = require('@/features/navigation/components/ComingSoon');
    /* eslint-enable @typescript-eslint/no-require-imports */
    return <ComingSoon title="Restaurants" message="The restaurant map is coming soon." />;
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
  },
}));

const mocked = supabase as unknown as {
  auth: { getSession: jest.Mock };
  from: jest.Mock;
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

// What the mocked database currently returns; tests change it to simulate a refetch.
let current: typeof profile;

type QueryBuilder = { select: jest.Mock; eq: jest.Mock; maybeSingle: jest.Mock };

function mockProfileTable() {
  const builder: QueryBuilder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => ({ data: current, error: null })),
  };
  mocked.from.mockReturnValue(builder);
}

const TAB_LABELS = ['Restaurants', 'Homemade', 'Profile'];

describe('tab bar', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    queryClient.clear();
    await AsyncStorage.clear();
    current = { ...profile };
    mockProfileTable();
  });

  describe('guest', () => {
    beforeEach(() => {
      mocked.auth.getSession.mockResolvedValue({ data: { session: null } });
    });

    it('shows exactly Restaurants, Homemade and Profile', async () => {
      await renderRouter('./app', { initialUrl: '/restaurants' });
      for (const label of TAB_LABELS) {
        expect(await screen.findByLabelText(`${label} tab`)).toBeTruthy();
      }
      expect(screen.queryByLabelText('Manage tab')).toBeNull();
      expect(screen.queryByText('Manage')).toBeNull();
    });

    it('shows the tab labels as visible text, not icons only', async () => {
      await renderRouter('./app', { initialUrl: '/restaurants' });
      await screen.findByLabelText('Restaurants tab');
      // Scoped to each tab: "Restaurants" is also the open screen's h1.
      for (const label of TAB_LABELS) {
        expect(within(screen.getByLabelText(`${label} tab`)).getByText(label)).toBeTruthy();
      }
    });

    it('announces the focused tab as selected and the others as not', async () => {
      await renderRouter('./app', { initialUrl: '/restaurants' });
      const restaurants = await screen.findByLabelText('Restaurants tab');
      expect(restaurants).toBeSelected();
      expect(screen.getByLabelText('Homemade tab')).not.toBeSelected();
      expect(screen.getByLabelText('Profile tab')).not.toBeSelected();
    });

    it('moves the selected state when switching tabs', async () => {
      await renderRouter('./app', { initialUrl: '/restaurants' });
      await fireEvent.press(await screen.findByLabelText('Homemade tab'));
      expect(await screen.findByText('Homemade food near you is coming soon.')).toBeTruthy();
      expect(screen.getByLabelText('Homemade tab')).toBeSelected();
      expect(screen.getByLabelText('Restaurants tab')).not.toBeSelected();
    });

    it('renders the placeholder screens with their h1 headers and copy', async () => {
      await renderRouter('./app', { initialUrl: '/restaurants' });
      expect(await screen.findByRole('header', { name: 'Restaurants' })).toBeTruthy();
      expect(screen.getByText('The restaurant map is coming soon.')).toBeTruthy();
      await fireEvent.press(screen.getByLabelText('Homemade tab'));
      expect(await screen.findByRole('header', { name: 'Homemade' })).toBeTruthy();
      expect(screen.getByText('Homemade food near you is coming soon.')).toBeTruthy();
    });

    it('never queries the database', async () => {
      await renderRouter('./app', { initialUrl: '/restaurants' });
      await screen.findByLabelText('Restaurants tab');
      // Flush pending effects so a late query would be caught.
      await act(async () => {});
      expect(mocked.from).not.toHaveBeenCalled();
    });
  });

  describe('signed in, not a seller', () => {
    beforeEach(() => {
      mocked.auth.getSession.mockResolvedValue({ data: { session } });
    });

    it('shows three tabs and no Manage', async () => {
      await renderRouter('./app', { initialUrl: '/restaurants' });
      for (const label of TAB_LABELS) {
        expect(await screen.findByLabelText(`${label} tab`)).toBeTruthy();
      }
      expect(screen.queryByLabelText('Manage tab')).toBeNull();
    });

    it('redirects /manage to /restaurants', async () => {
      await renderRouter('./app', { initialUrl: '/manage' });
      expect(await screen.findByText('The restaurant map is coming soon.')).toBeTruthy();
      expect(screen).toHavePathname('/restaurants');
    });
  });

  describe('signed in, seller', () => {
    beforeEach(() => {
      mocked.auth.getSession.mockResolvedValue({ data: { session } });
      current = { ...profile, is_seller: true };
    });

    it('shows four tabs including Manage', async () => {
      await renderRouter('./app', { initialUrl: '/restaurants' });
      for (const label of [...TAB_LABELS, 'Manage']) {
        expect(await screen.findByLabelText(`${label} tab`)).toBeTruthy();
      }
      expect(screen.getByText('Manage')).toBeTruthy();
    });

    it('opens Manage Business from the Manage tab', async () => {
      await renderRouter('./app', { initialUrl: '/restaurants' });
      await fireEvent.press(await screen.findByLabelText('Manage tab'));
      expect(await screen.findByRole('header', { name: 'Manage Business' })).toBeTruthy();
      expect(screen.getByLabelText('Manage tab')).toBeSelected();
    });

    it('opens Manage Business directly at /manage', async () => {
      await renderRouter('./app', { initialUrl: '/manage' });
      expect(await screen.findByRole('header', { name: 'Manage Business' })).toBeTruthy();
      expect(screen).toHavePathname('/manage');
    });
  });

  describe('is_seller changes while the app is open', () => {
    beforeEach(() => {
      mocked.auth.getSession.mockResolvedValue({ data: { session } });
    });

    it('shows the Manage tab when the cached profile becomes a seller', async () => {
      await renderRouter('./app', { initialUrl: '/restaurants' });
      await screen.findByLabelText('Profile tab');
      await screen.findByText('The restaurant map is coming soon.');
      expect(screen.queryByLabelText('Manage tab')).toBeNull();

      current = { ...profile, is_seller: true };
      await act(async () => {
        queryClient.setQueryData(myProfileKey, current);
      });
      expect(await screen.findByLabelText('Manage tab')).toBeTruthy();
    });

    it('hides the Manage tab again when is_seller flips back to false', async () => {
      current = { ...profile, is_seller: true };
      await renderRouter('./app', { initialUrl: '/restaurants' });
      await screen.findByLabelText('Manage tab');

      current = { ...profile, is_seller: false };
      await act(async () => {
        queryClient.setQueryData(myProfileKey, current);
      });
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: myProfileKey });
      });
      // The tab navigator drops a removed route on its next render, so wait for it.
      await waitFor(() => expect(screen.queryByLabelText('Manage tab')).toBeNull());
    });
  });
});
