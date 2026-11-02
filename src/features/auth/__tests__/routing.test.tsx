import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderRouter, screen } from 'expo-router/testing-library';

import { queryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';

// Renders the real app/ routes so the Stack.Protected guards and their redirects are exercised,
// including the cold start at "/" (regression: signed-out launch showed "Unmatched Route").

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      getSession: jest.fn(),
    },
    from: jest.fn(),
  },
}));

const mocked = supabase as unknown as { auth: { getSession: jest.Mock }; from: jest.Mock };
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

type QueryBuilder = { select: jest.Mock; eq: jest.Mock; maybeSingle: jest.Mock };

function mockProfile(profile: typeof baseProfile) {
  const builder: QueryBuilder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => ({ data: profile, error: null })),
  };
  mocked.from.mockReturnValue(builder);
}

describe('route guards on cold start', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // The root layout uses the app's shared client; don't let one test's cached profile leak.
    queryClient.clear();
    await AsyncStorage.clear();
  });

  it('opens sign-in when signed out', async () => {
    mocked.auth.getSession.mockResolvedValue({ data: { session: null } });
    await renderRouter('./app', { initialUrl: '/' });
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen).toHavePathname('/sign-in');
  });

  it('opens setup-profile, not home, when the username is not set', async () => {
    mocked.auth.getSession.mockResolvedValue({ data: { session } });
    mockProfile(baseProfile);
    await renderRouter('./app', { initialUrl: '/' });
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(screen).toHavePathname('/setup-profile');
  });

  it('keeps an incomplete profile out of edit profile too', async () => {
    mocked.auth.getSession.mockResolvedValue({ data: { session } });
    mockProfile(baseProfile);
    await renderRouter('./app', { initialUrl: '/profile/edit' });
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(screen).toHavePathname('/setup-profile');
  });

  it('opens home with the profile when the profile is complete', async () => {
    mocked.auth.getSession.mockResolvedValue({ data: { session } });
    mockProfile({ ...baseProfile, username: 'archan', display_name: 'Archan Me' });
    await renderRouter('./app', { initialUrl: '/' });
    expect(await screen.findByText('@archan')).toBeTruthy();
    expect(screen.getByLabelText("Archan Me's profile picture")).toBeTruthy();
    expect(screen).toHavePathname('/');
  });

  it('sends a complete profile away from setup-profile to home', async () => {
    mocked.auth.getSession.mockResolvedValue({ data: { session } });
    mockProfile({ ...baseProfile, username: 'archan', display_name: 'Archan Me' });
    await renderRouter('./app', { initialUrl: '/setup-profile' });
    expect(await screen.findByText('@archan')).toBeTruthy();
    expect(screen).toHavePathname('/');
  });

  it('opens reset-password, not home or setup, when relaunched mid-recovery', async () => {
    mocked.auth.getSession.mockResolvedValue({ data: { session } });
    await AsyncStorage.setItem('liketoorder.auth.isRecovering', 'true');
    await renderRouter('./app', { initialUrl: '/' });
    expect(await screen.findByLabelText('New password')).toBeTruthy();
    expect(screen).toHavePathname('/reset-password');
    // The profile isn't even fetched while recovering.
    expect(mocked.from).not.toHaveBeenCalled();
  });

  it('shows reset-password to a signed-out user who opens it directly', async () => {
    mocked.auth.getSession.mockResolvedValue({ data: { session: null } });
    await renderRouter('./app', { initialUrl: '/reset-password' });
    expect(await screen.findByText('Start again to get a new reset code.')).toBeTruthy();
    expect(screen).toHavePathname('/reset-password');
  });
});
