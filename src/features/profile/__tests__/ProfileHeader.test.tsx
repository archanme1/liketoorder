import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import * as api from '../api';
import { ProfileHeader } from '../components/ProfileHeader';

jest.mock('@/lib/supabase', () => ({ supabase: { auth: {} } }));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getMyProfile: jest.fn(),
}));

const realApi = jest.requireActual<typeof import('../api')>('../api');
const mockedApi = jest.mocked(api);

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

async function renderHeader() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  await render(
    <QueryClientProvider client={client}>
      <ProfileHeader />
    </QueryClientProvider>,
  );
  return client;
}

describe('ProfileHeader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks keeps queued *Once values; reset so a failed test can't leak into the next.
    mockedApi.getMyProfile.mockReset();
  });

  it('shows a loading container while loading', async () => {
    mockedApi.getMyProfile.mockReturnValue(new Promise(() => {}));
    await renderHeader();
    expect(screen.getByLabelText('Loading profile')).toBeTruthy();
  });

  it('shows an error with a Try again button that refetches', async () => {
    mockedApi.getMyProfile.mockRejectedValueOnce(new realApi.ProfileAppError('network'));
    mockedApi.getMyProfile.mockResolvedValueOnce(profile);
    await renderHeader();
    expect(await screen.findByRole('alert')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('@archan')).toBeTruthy();
    expect(mockedApi.getMyProfile).toHaveBeenCalledTimes(2);
  });

  it('keeps showing the loaded profile when a background refetch fails', async () => {
    mockedApi.getMyProfile.mockResolvedValueOnce(profile);
    mockedApi.getMyProfile.mockRejectedValueOnce(new realApi.ProfileAppError('network'));
    const client = await renderHeader();
    await screen.findByText('@archan');
    await act(async () => {
      await client.refetchQueries();
    });
    expect(mockedApi.getMyProfile).toHaveBeenCalledTimes(2);
    expect(screen.getByText('@archan')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('renders no empty heading when the display name is missing', async () => {
    mockedApi.getMyProfile.mockResolvedValue({ ...profile, display_name: null });
    await renderHeader();
    await screen.findByText('@archan');
    expect(screen.queryByRole('header')).toBeNull();
  });

  it('shows an empty state with Try again when there is no profile', async () => {
    mockedApi.getMyProfile.mockResolvedValue(null as unknown as api.Profile);
    await renderHeader();
    const retry = await screen.findByRole('button', { name: 'Try again' });
    await fireEvent.press(retry);
    expect(mockedApi.getMyProfile).toHaveBeenCalledTimes(2);
  });

  it('shows avatar, name, username, bio and city on success', async () => {
    mockedApi.getMyProfile.mockResolvedValue(profile);
    await renderHeader();
    expect(await screen.findByLabelText("Archan Me's profile picture")).toBeTruthy();
    expect(screen.getByText('AM')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Archan Me' })).toBeTruthy();
    expect(screen.getByText('@archan')).toBeTruthy();
    expect(screen.getByText('I like noodles')).toBeTruthy();
    expect(screen.getByText('Paris')).toBeTruthy();
    expect(screen.queryByLabelText('Loading profile')).toBeNull();
  });

  it('hides the bio and city lines when they are empty', async () => {
    mockedApi.getMyProfile.mockResolvedValue({ ...profile, bio: '', city: '' });
    await renderHeader();
    await screen.findByText('@archan');
    expect(screen.queryByText('I like noodles')).toBeNull();
    expect(screen.queryByText('Paris')).toBeNull();
  });

  it('hides only the empty line', async () => {
    mockedApi.getMyProfile.mockResolvedValue({ ...profile, bio: '' });
    await renderHeader();
    await screen.findByText('@archan');
    expect(screen.queryByText('I like noodles')).toBeNull();
    expect(screen.getByText('Paris')).toBeTruthy();
  });
});
