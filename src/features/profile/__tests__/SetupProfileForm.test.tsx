import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import * as api from '../api';
import { SetupProfileForm } from '../components/SetupProfileForm';
import { USERNAME_HINT } from '../schema';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(),
};

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: {} } }));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getMyProfile: jest.fn(),
  updateMyProfile: jest.fn(),
}));

const realApi = jest.requireActual<typeof import('../api')>('../api');
const mockedApi = jest.mocked(api);

const profile: api.Profile = {
  id: 'u1',
  username: 'archan',
  display_name: 'Archan',
  bio: '',
  city: '',
  is_seller: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

async function renderForm() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  await render(
    <QueryClientProvider client={client}>
      <SetupProfileForm />
    </QueryClientProvider>,
  );
}

async function fillAndSubmit(displayName: string, username: string) {
  await fireEvent.changeText(screen.getByLabelText('Display name'), displayName);
  await fireEvent.changeText(screen.getByLabelText('Username'), username);
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
}

describe('SetupProfileForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.updateMyProfile.mockResolvedValue(profile);
  });

  it('renders fields, the username hint and a labelled Continue button', async () => {
    await renderForm();
    expect(screen.getByLabelText('Display name')).toBeTruthy();
    expect(screen.getByLabelText('Username')).toBeTruthy();
    expect(screen.getByText(USERNAME_HINT)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' }).props.accessibilityLabel).toBe(
      'Continue',
    );
  });

  it('turns off auto-capitalisation on the username', async () => {
    await renderForm();
    expect(screen.getByLabelText('Username').props.autoCapitalize).toBe('none');
  });

  it.each([
    ['empty display name', '', 'archan'],
    ['whitespace display name', '   ', 'archan'],
    ['too-short username', 'Archan', 'ab'],
    ['username with a space', 'Archan', 'has space'],
    ['too-long username', 'Archan', 'a'.repeat(21)],
  ])('rejects %s without calling the api', async (_name, displayName, username) => {
    await renderForm();
    await fillAndSubmit(displayName, username);
    expect((await screen.findAllByText(/⚠/)).length).toBeGreaterThan(0);
    expect(mockedApi.updateMyProfile).not.toHaveBeenCalled();
  });

  it('submits trimmed display name and lowercased username only', async () => {
    await renderForm();
    await fillAndSubmit('  Archan Me ', ' Archan_1 ');
    await screen.findByRole('button', { name: 'Continue' });
    expect(mockedApi.updateMyProfile).toHaveBeenCalledTimes(1);
    expect(mockedApi.updateMyProfile).toHaveBeenCalledWith({
      display_name: 'Archan Me',
      username: 'archan_1',
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not navigate itself on success (the route guard does)', async () => {
    await renderForm();
    await fillAndSubmit('Archan', 'archan');
    await screen.findByRole('button', { name: 'Continue' });
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('shows username_taken as a field error, not a banner', async () => {
    mockedApi.updateMyProfile.mockRejectedValue(new realApi.ProfileAppError('username_taken'));
    await renderForm();
    await fillAndSubmit('Archan', 'taken');
    expect(await screen.findByText('⚠ Username is taken')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows other errors in a banner', async () => {
    mockedApi.updateMyProfile.mockRejectedValue(new realApi.ProfileAppError('network'));
    await renderForm();
    await fillAndSubmit('Archan', 'archan');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('⚠ Username is taken')).toBeNull();
  });
});
