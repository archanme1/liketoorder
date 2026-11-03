import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AuthProvider } from '@/features/auth/components/AuthProvider';
import * as authApi from '@/features/auth/api';
import { authErrorMessage, PASSWORD_UPDATED } from '@/features/auth/messages';
import { supabase } from '@/lib/supabase';

import * as api from '../api';
import { ProfileScreen } from '../components/ProfileScreen';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn() };
let mockParams: { notice?: string } = {};

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { onAuthStateChange: jest.fn(), getSession: jest.fn() },
  },
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getMyProfile: jest.fn(),
}));
jest.mock('@/features/auth/api', () => ({
  ...jest.requireActual('@/features/auth/api'),
  signOut: jest.fn(),
}));

const realProfileApi = jest.requireActual<typeof import('../api')>('../api');
const realAuthApi = jest.requireActual<typeof import('@/features/auth/api')>('@/features/auth/api');
const mockedApi = jest.mocked(api);
const mockedAuthApi = jest.mocked(authApi);
const auth = supabase.auth as unknown as Record<string, jest.Mock>;

const profile: api.Profile = {
  id: 'u1',
  username: 'archan',
  display_name: 'Archan Me',
  bio: 'I like noodles',
  city: 'Paris',
  is_seller: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const session = { access_token: 't', refresh_token: 'r', user: { id: 'u1' } };

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
        <ProfileScreen />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return client;
}

describe('ProfileScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    mockedApi.getMyProfile.mockReset();
    mockedApi.getMyProfile.mockResolvedValue(profile);
    mockedAuthApi.signOut.mockResolvedValue(undefined);
    auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
    auth.getSession.mockResolvedValue({ data: { session } });
  });

  it('shows the loading state while the profile loads', async () => {
    mockedApi.getMyProfile.mockReturnValue(new Promise(() => {}));
    await renderScreen();
    expect(screen.getByLabelText('Loading profile')).toBeTruthy();
  });

  it('shows an error with a Try again button that refetches', async () => {
    mockedApi.getMyProfile.mockRejectedValueOnce(new realProfileApi.ProfileAppError('network'));
    mockedApi.getMyProfile.mockResolvedValueOnce(profile);
    await renderScreen();
    expect(await screen.findByRole('alert')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('@archan')).toBeTruthy();
    expect(mockedApi.getMyProfile).toHaveBeenCalledTimes(2);
  });

  it('shows the profile, Edit profile and Sign out on success', async () => {
    await renderScreen();
    expect(await screen.findByText('@archan')).toBeTruthy();
    expect(screen.getByLabelText("Archan Me's profile picture")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit profile' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('shows no password-updated banner by default', async () => {
    await renderScreen();
    await screen.findByText('@archan');
    expect(screen.queryByText(PASSWORD_UPDATED)).toBeNull();
  });

  it('shows the "Password updated" banner when the notice param is password-updated', async () => {
    mockParams = { notice: 'password-updated' };
    await renderScreen();
    expect(await screen.findByText(PASSWORD_UPDATED)).toBeTruthy();
    expect(await screen.findByText('@archan')).toBeTruthy();
  });

  it('ignores an unknown notice param', async () => {
    mockParams = { notice: 'something-else' };
    await renderScreen();
    await screen.findByText('@archan');
    expect(screen.queryByText(PASSWORD_UPDATED)).toBeNull();
  });

  it('"Edit profile" opens the edit screen', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Edit profile' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/profile/edit');
  });

  it('"Sign out" signs the user out', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(mockedAuthApi.signOut).toHaveBeenCalledTimes(1));
  });

  it('shows an error banner when sign-out fails', async () => {
    mockedAuthApi.signOut.mockRejectedValue(new realAuthApi.AuthAppError('unknown'));
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText(authErrorMessage('unknown'))).toBeTruthy();
  });
});
