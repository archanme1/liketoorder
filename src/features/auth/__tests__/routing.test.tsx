import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderRouter, screen } from 'expo-router/testing-library';

import { supabase } from '@/lib/supabase';

// Renders the real app/ routes so the Stack.Protected guards and their redirects are exercised,
// including the cold start at "/" (regression: signed-out launch showed "Unmatched Route").

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      getSession: jest.fn(),
    },
  },
}));

const auth = supabase.auth as unknown as { getSession: jest.Mock };
const session = { access_token: 't', refresh_token: 'r', user: { id: 'u1', email: 'a@b.com' } };

describe('route guards on cold start', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('opens sign-in when signed out', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    await renderRouter('./app', { initialUrl: '/' });
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen).toHavePathname('/sign-in');
  });

  it('opens home when signed in', async () => {
    auth.getSession.mockResolvedValue({ data: { session } });
    await renderRouter('./app', { initialUrl: '/' });
    expect(await screen.findByText('Signed in as a@b.com')).toBeTruthy();
    expect(screen).toHavePathname('/');
  });

  it('opens reset-password, not home, when relaunched mid-recovery', async () => {
    auth.getSession.mockResolvedValue({ data: { session } });
    await AsyncStorage.setItem('liketoorder.auth.isRecovering', 'true');
    await renderRouter('./app', { initialUrl: '/' });
    expect(await screen.findByLabelText('New password')).toBeTruthy();
    expect(screen).toHavePathname('/reset-password');
  });

  it('keeps a signed-out user away from home when deep-linked there', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    await renderRouter('./app', { initialUrl: '/reset-password' });
    expect(await screen.findByText('Start again to get a new reset code.')).toBeTruthy();
    expect(screen).toHavePathname('/reset-password');
  });
});
