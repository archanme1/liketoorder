import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthApiError } from '@supabase/supabase-js';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { queryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';

import { authErrorMessage, PASSWORD_UPDATED } from '../messages';

// Renders the real app/ routes so the Stack.Protected guards and their redirects are exercised,
// including the cold start at "/" (regression: signed-out launch showed "Unmatched Route").

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      getSession: jest.fn(),
      signOut: jest.fn(async () => ({ error: null })),
      signInWithPassword: jest.fn(),
      updateUser: jest.fn(),
    },
    from: jest.fn(),
  },
}));

const mocked = supabase as unknown as {
  auth: {
    onAuthStateChange: jest.Mock;
    getSession: jest.Mock;
    signOut: jest.Mock;
    signInWithPassword: jest.Mock;
    updateUser: jest.Mock;
  };
  from: jest.Mock;
};
const session = { access_token: 't', refresh_token: 'r', user: { id: 'u1', email: 'a@b.com' } };
const baseProfile = {
  id: 'u1',
  username: null as string | null,
  display_name: null as string | null,
  bio: '',
  city: '',
  is_seller: false,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};
const completeProfile = { ...baseProfile, username: 'archan', display_name: 'Archan Me' };

const GUEST_PROMPT = 'Sign in to see your profile, and later to send requests and log food.';
const RESTAURANTS_COPY = 'The restaurant map is coming soon.';
const HOMEMADE_COPY = 'Homemade food near you is coming soon.';

type QueryBuilder = { select: jest.Mock; eq: jest.Mock; maybeSingle: jest.Mock };

function mockProfile(profile: typeof baseProfile) {
  const builder: QueryBuilder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => ({ data: profile, error: null })),
  };
  mocked.from.mockReturnValue(builder);
}

type Listener = (event: string, value: unknown) => void;
let listener: Listener | undefined;

const appQueryDefaults = queryClient.getDefaultOptions();

describe('route guards on cold start', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // The root layout uses the app's shared client; don't let one test's cached profile leak.
    queryClient.clear();
    await AsyncStorage.clear();
    listener = undefined;
    mocked.auth.onAuthStateChange.mockImplementation((cb: Listener) => {
      listener = cb;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });
    // clearAllMocks keeps implementations, so reset the ones individual tests override.
    mocked.auth.signOut.mockReset();
    // Called from inside the press's act(), so emit directly: a nested act() leaks into later tests.
    mocked.auth.signOut.mockImplementation(async () => {
      listener?.('SIGNED_OUT', null);
      return { error: null };
    });
    mocked.auth.signInWithPassword.mockReset();
    mocked.auth.updateUser.mockReset();
  });

  afterEach(() => {
    queryClient.setDefaultOptions(appQueryDefaults);
  });

  describe('guest', () => {
    beforeEach(() => {
      mocked.auth.getSession.mockResolvedValue({ data: { session: null } });
    });

    it('lands on Restaurants when signed out', async () => {
      await renderRouter('./app', { initialUrl: '/' });
      expect(await screen.findByText(RESTAURANTS_COPY)).toBeTruthy();
      expect(screen).toHavePathname('/restaurants');
    });

    it('can open Homemade without signing in', async () => {
      await renderRouter('./app', { initialUrl: '/' });
      await screen.findByText(RESTAURANTS_COPY);
      await fireEvent.press(screen.getByLabelText('Homemade tab'));
      expect(await screen.findByText(HOMEMADE_COPY)).toBeTruthy();
      expect(screen).toHavePathname('/homemade');
    });

    it('can open Profile and sees the sign-in prompt', async () => {
      await renderRouter('./app', { initialUrl: '/' });
      await screen.findByText(RESTAURANTS_COPY);
      await fireEvent.press(screen.getByLabelText('Profile tab'));
      expect(await screen.findByText(GUEST_PROMPT)).toBeTruthy();
      expect(screen).toHavePathname('/profile');
    });

    it('shows exactly three tabs, no Manage', async () => {
      await renderRouter('./app', { initialUrl: '/' });
      await screen.findByText(RESTAURANTS_COPY);
      expect(screen.getByLabelText('Restaurants tab')).toBeTruthy();
      expect(screen.getByLabelText('Homemade tab')).toBeTruthy();
      expect(screen.getByLabelText('Profile tab')).toBeTruthy();
      expect(screen.queryByLabelText('Manage tab')).toBeNull();
    });

    it('redirects /manage to /restaurants', async () => {
      await renderRouter('./app', { initialUrl: '/manage' });
      expect(await screen.findByText(RESTAURANTS_COPY)).toBeTruthy();
      expect(screen).toHavePathname('/restaurants');
    });

    it('opens the Profile prompt directly at /profile', async () => {
      await renderRouter('./app', { initialUrl: '/profile' });
      expect(await screen.findByText(GUEST_PROMPT)).toBeTruthy();
      expect(screen).toHavePathname('/profile');
    });

    it('makes no supabase.from call while browsing', async () => {
      await renderRouter('./app', { initialUrl: '/' });
      await screen.findByText(RESTAURANTS_COPY);
      await fireEvent.press(screen.getByLabelText('Homemade tab'));
      await screen.findByText(HOMEMADE_COPY);
      await fireEvent.press(screen.getByLabelText('Profile tab'));
      await screen.findByText(GUEST_PROMPT);
      expect(mocked.from).not.toHaveBeenCalled();
    });

    it('opens sign-in from the Profile prompt and Close returns to browsing', async () => {
      await renderRouter('./app', { initialUrl: '/profile' });
      await fireEvent.press(await screen.findByRole('button', { name: 'Sign in' }));
      expect(await screen.findByLabelText('Email')).toBeTruthy();
      expect(screen).toHavePathname('/sign-in');
      await fireEvent.press(screen.getByLabelText('Close and keep browsing'));
      expect(await screen.findByText(GUEST_PROMPT)).toBeTruthy();
      expect(screen).toHavePathname('/profile');
    });

    it('opens sign-up from the Profile prompt', async () => {
      await renderRouter('./app', { initialUrl: '/profile' });
      await fireEvent.press(await screen.findByRole('button', { name: 'Create account' }));
      expect(screen).toHavePathname('/sign-up');
    });

    it('Close on sign-in opened directly falls back to /restaurants', async () => {
      await renderRouter('./app', { initialUrl: '/sign-in' });
      await fireEvent.press(await screen.findByLabelText('Close and keep browsing'));
      expect(await screen.findByText(RESTAURANTS_COPY)).toBeTruthy();
      expect(screen).toHavePathname('/restaurants');
    });

    it('lands on the Profile tab with the profile after signing in from the prompt', async () => {
      mockProfile(completeProfile);
      // Called from inside the press's act(), so emit directly (see signOut in beforeEach).
      // getMyProfile reads the session too, so it must see the signed-in one from now on.
      mocked.auth.signInWithPassword.mockImplementation(async () => {
        mocked.auth.getSession.mockResolvedValue({ data: { session } });
        listener?.('SIGNED_IN', session);
        return { data: { session, user: session.user }, error: null };
      });
      await renderRouter('./app', { initialUrl: '/profile' });
      await fireEvent.press(await screen.findByRole('button', { name: 'Sign in' }));
      await fireEvent.changeText(await screen.findByLabelText('Email'), 'a@b.com');
      await fireEvent.changeText(screen.getByLabelText('Password'), 'abcdefg1');
      const submit = screen.getAllByRole('button', { name: 'Sign in' });
      await fireEvent.press(submit[submit.length - 1]);
      expect(await screen.findByText('@archan')).toBeTruthy();
      expect(screen).toHavePathname('/profile');
    });

    it('shows reset-password to a signed-out user who opens it directly', async () => {
      await renderRouter('./app', { initialUrl: '/reset-password' });
      expect(await screen.findByText('Start again to get a new reset code.')).toBeTruthy();
      expect(screen).toHavePathname('/reset-password');
    });
  });

  describe('incomplete profile', () => {
    beforeEach(() => {
      mocked.auth.getSession.mockResolvedValue({ data: { session } });
      mockProfile(baseProfile);
    });

    it('opens setup-profile, not the tabs, when the username is not set', async () => {
      await renderRouter('./app', { initialUrl: '/' });
      expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy();
      expect(screen).toHavePathname('/setup-profile');
    });

    it.each(['/restaurants', '/homemade', '/profile', '/manage'])(
      'keeps %s unreachable',
      async (url) => {
        await renderRouter('./app', { initialUrl: url });
        expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy();
        expect(screen).toHavePathname('/setup-profile');
      },
    );

    it('keeps an incomplete profile out of edit profile too', async () => {
      await renderRouter('./app', { initialUrl: '/profile/edit' });
      expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy();
      expect(screen).toHavePathname('/setup-profile');
    });
  });

  describe('complete profile', () => {
    beforeEach(() => {
      mocked.auth.getSession.mockResolvedValue({ data: { session } });
      mockProfile(completeProfile);
    });

    it('cold start lands on Restaurants with three tabs', async () => {
      await renderRouter('./app', { initialUrl: '/' });
      expect(await screen.findByText(RESTAURANTS_COPY)).toBeTruthy();
      expect(screen).toHavePathname('/restaurants');
      expect(screen.getByLabelText('Homemade tab')).toBeTruthy();
      expect(screen.getByLabelText('Profile tab')).toBeTruthy();
      expect(screen.queryByLabelText('Manage tab')).toBeNull();
    });

    it('/profile shows the username and the avatar label', async () => {
      await renderRouter('./app', { initialUrl: '/profile' });
      expect(await screen.findByText('@archan')).toBeTruthy();
      expect(screen.getByLabelText("Archan Me's profile picture")).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Edit profile' })).toBeTruthy();
      expect(screen).toHavePathname('/profile');
    });

    it('sends a complete profile away from setup-profile to the Profile tab', async () => {
      await renderRouter('./app', { initialUrl: '/setup-profile' });
      expect(await screen.findByText('@archan')).toBeTruthy();
      expect(screen).toHavePathname('/profile');
    });

    it('sends a signed-in user away from sign-in to the Profile tab', async () => {
      await renderRouter('./app', { initialUrl: '/sign-in' });
      expect(await screen.findByText('@archan')).toBeTruthy();
      expect(screen).toHavePathname('/profile');
    });

    it('sends a signed-in user away from sign-up to the Profile tab', async () => {
      await renderRouter('./app', { initialUrl: '/sign-up' });
      expect(await screen.findByText('@archan')).toBeTruthy();
      expect(screen).toHavePathname('/profile');
    });

    it('treats /profile/edit and /profile as distinct screens', async () => {
      await renderRouter('./app', { initialUrl: '/profile/edit' });
      expect(await screen.findByLabelText('Display name')).toBeTruthy();
      expect(screen).toHavePathname('/profile/edit');
      expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    });

    it('opens edit profile from the Profile tab', async () => {
      await renderRouter('./app', { initialUrl: '/profile' });
      await fireEvent.press(await screen.findByRole('button', { name: 'Edit profile' }));
      expect(await screen.findByLabelText('Display name')).toBeTruthy();
      expect(screen).toHavePathname('/profile/edit');
    });

    it('redirects a non-seller from /manage to /restaurants', async () => {
      await renderRouter('./app', { initialUrl: '/manage' });
      expect(await screen.findByText(RESTAURANTS_COPY)).toBeTruthy();
      expect(screen).toHavePathname('/restaurants');
    });

    it('signing out stays on /profile and shows the guest prompt', async () => {
      await renderRouter('./app', { initialUrl: '/profile' });
      await fireEvent.press(await screen.findByRole('button', { name: 'Sign out' }));
      expect(await screen.findByText(GUEST_PROMPT)).toBeTruthy();
      expect(screen).toHavePathname('/profile');
      expect(screen.queryByText('@archan')).toBeNull();
    });

    it('shows an error banner on the Profile tab when sign-out fails', async () => {
      // Both the global and the local fallback sign-out fail.
      mocked.auth.signOut.mockResolvedValue({ error: new AuthApiError('boom', 500, undefined) });
      await renderRouter('./app', { initialUrl: '/profile' });
      await fireEvent.press(await screen.findByRole('button', { name: 'Sign out' }));
      expect(await screen.findByText(authErrorMessage('unknown'))).toBeTruthy();
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen).toHavePathname('/profile');
    });

    it('shows the "Password updated" banner on the Profile tab after a reset', async () => {
      await renderRouter('./app', { initialUrl: '/profile?notice=password-updated' });
      expect(await screen.findByText('@archan')).toBeTruthy();
      expect(screen.getByText(PASSWORD_UPDATED)).toBeTruthy();
      expect(screen).toHavePathname('/profile');
    });

    it('does not show the banner on a plain /profile', async () => {
      await renderRouter('./app', { initialUrl: '/profile' });
      await screen.findByText('@archan');
      expect(screen.queryByText(PASSWORD_UPDATED)).toBeNull();
    });
  });

  describe('seller', () => {
    beforeEach(() => {
      mocked.auth.getSession.mockResolvedValue({ data: { session } });
      mockProfile({ ...completeProfile, is_seller: true });
    });

    it('shows the Manage tab', async () => {
      await renderRouter('./app', { initialUrl: '/' });
      expect(await screen.findByLabelText('Manage tab')).toBeTruthy();
    });

    it('hides the Manage tab when the seller signs out', async () => {
      await renderRouter('./app', { initialUrl: '/profile' });
      await screen.findByLabelText('Manage tab');
      await fireEvent.press(await screen.findByRole('button', { name: 'Sign out' }));
      expect(await screen.findByText(GUEST_PROMPT)).toBeTruthy();
      await waitFor(() => expect(screen.queryByLabelText('Manage tab')).toBeNull());
    });

    it('/manage shows "Manage Business"', async () => {
      await renderRouter('./app', { initialUrl: '/manage' });
      expect(await screen.findByRole('header', { name: 'Manage Business' })).toBeTruthy();
      expect(screen).toHavePathname('/manage');
    });
  });

  describe('profile load failure', () => {
    it('offers Try again and Sign out when the profile fails to load', async () => {
      mocked.auth.getSession.mockResolvedValue({ data: { session } });
      const builder: QueryBuilder = {
        select: jest.fn(() => builder),
        eq: jest.fn(() => builder),
        maybeSingle: jest.fn(async () => ({ data: null, error: { message: 'Failed to fetch' } })),
      };
      mocked.from.mockReturnValue(builder);
      // Skip the app's one retry (a real 1 s delay) so the error screen shows straight away.
      queryClient.setDefaultOptions({
        ...appQueryDefaults,
        queries: { ...appQueryDefaults.queries, retry: false },
      });
      await renderRouter('./app', { initialUrl: '/profile' });
      const signOut = await screen.findByRole('button', { name: 'Sign out' });
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
      await fireEvent.press(signOut);
      expect(mocked.auth.signOut).toHaveBeenCalled();
    });
  });

  describe('recovery', () => {
    beforeEach(async () => {
      mocked.auth.getSession.mockResolvedValue({ data: { session } });
      await AsyncStorage.setItem('liketoorder.auth.isRecovering', 'true');
    });

    it('opens reset-password, not the tabs or setup, when relaunched mid-recovery', async () => {
      await renderRouter('./app', { initialUrl: '/' });
      expect(await screen.findByLabelText('New password')).toBeTruthy();
      expect(screen).toHavePathname('/reset-password');
      // The profile isn't even fetched while recovering.
      expect(mocked.from).not.toHaveBeenCalled();
    });

    it.each(['/restaurants', '/homemade', '/profile', '/manage'])(
      'keeps %s unreachable mid-recovery',
      async (url) => {
        await renderRouter('./app', { initialUrl: url });
        expect(await screen.findByLabelText('New password')).toBeTruthy();
        expect(screen).toHavePathname('/reset-password');
        expect(mocked.from).not.toHaveBeenCalled();
      },
    );

    it('saving the new password lands on the Profile tab with the "Password updated" banner', async () => {
      mockProfile(completeProfile);
      mocked.auth.updateUser.mockResolvedValue({ data: { user: session.user }, error: null });
      await renderRouter('./app', { initialUrl: '/' });
      await fireEvent.changeText(await screen.findByLabelText('New password'), 'abcdefg1');
      await fireEvent.changeText(screen.getByLabelText('Confirm new password'), 'abcdefg1');
      await fireEvent.press(screen.getByRole('button', { name: 'Save password' }));
      expect(await screen.findByText('@archan')).toBeTruthy();
      expect(screen).toHavePathname('/profile');
      // The reset form navigates with the notice param, not only the session notice fallback.
      expect(screen).toHaveSearchParams({ notice: 'password-updated' });
      expect(screen.getByText(PASSWORD_UPDATED)).toBeTruthy();
    });

    it('Cancel signs out and lands on the Profile tab guest prompt', async () => {
      await renderRouter('./app', { initialUrl: '/' });
      await fireEvent.press(await screen.findByRole('button', { name: 'Cancel' }));
      expect(await screen.findByText(GUEST_PROMPT)).toBeTruthy();
      expect(mocked.auth.signOut).toHaveBeenCalled();
      expect(screen).toHavePathname('/profile');
    });
  });
});
