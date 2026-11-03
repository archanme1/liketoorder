import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import * as api from '../api';
import { EditProfileForm } from '../components/EditProfileForm';
import { USERNAME_TAKEN } from '../messages';

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
  display_name: 'Archan Me',
  bio: 'I like noodles',
  city: 'Paris',
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
      <EditProfileForm />
    </QueryClientProvider>,
  );
  return client;
}

async function renderLoaded() {
  const client = await renderForm();
  await screen.findByLabelText('Display name');
  return client;
}

describe('EditProfileForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouter.canGoBack.mockReturnValue(true);
    mockedApi.getMyProfile.mockResolvedValue(profile);
    mockedApi.updateMyProfile.mockResolvedValue(profile);
  });

  describe('loading and error states', () => {
    it('shows a loading container while the profile loads', async () => {
      mockedApi.getMyProfile.mockReturnValue(new Promise(() => {}));
      await renderForm();
      expect(screen.getByLabelText('Loading profile')).toBeTruthy();
      expect(screen.queryByLabelText('Display name')).toBeNull();
    });

    it('keeps the form and typed changes when a background refetch fails', async () => {
      const client = await renderLoaded();
      await fireEvent.changeText(screen.getByLabelText('City'), 'Lyon');
      mockedApi.getMyProfile.mockRejectedValueOnce(new realApi.ProfileAppError('network'));
      await act(async () => {
        await client.refetchQueries();
      });
      expect(mockedApi.getMyProfile).toHaveBeenCalledTimes(2);
      expect(screen.getByLabelText('City').props.value).toBe('Lyon');
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    it('shows an error with retry that refetches', async () => {
      mockedApi.getMyProfile.mockRejectedValueOnce(new realApi.ProfileAppError('network'));
      await renderForm();
      expect(await screen.findByRole('alert')).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByLabelText('Display name')).toBeTruthy();
      expect(mockedApi.getMyProfile).toHaveBeenCalledTimes(2);
    });
  });

  describe('success', () => {
    it('prefills the fields from the profile', async () => {
      await renderLoaded();
      expect(screen.getByLabelText('Display name').props.value).toBe('Archan Me');
      expect(screen.getByLabelText('Username').props.value).toBe('archan');
      expect(screen.getByLabelText('Bio').props.value).toBe('I like noodles');
      expect(screen.getByLabelText('City').props.value).toBe('Paris');
    });

    it('has labelled Save and Cancel buttons', async () => {
      await renderLoaded();
      expect(screen.getByRole('button', { name: 'Save' }).props.accessibilityLabel).toBe('Save');
      expect(screen.getByRole('button', { name: 'Cancel' }).props.accessibilityLabel).toBe(
        'Cancel',
      );
    });

    it('shows a live bio character count', async () => {
      await renderLoaded();
      expect(screen.getByText('14/160')).toBeTruthy();
      await fireEvent.changeText(screen.getByLabelText('Bio'), 'hello');
      expect(await screen.findByText('5/160')).toBeTruthy();
    });

    it('saves exactly display_name, username, bio and city, then navigates back', async () => {
      await renderLoaded();
      await fireEvent.changeText(screen.getByLabelText('Display name'), ' New Name ');
      await fireEvent.changeText(screen.getByLabelText('Bio'), 'New bio');
      await fireEvent.changeText(screen.getByLabelText('City'), 'Lyon');
      await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
      expect(mockedApi.updateMyProfile).toHaveBeenCalledTimes(1);
      expect(mockedApi.updateMyProfile).toHaveBeenCalledWith({
        display_name: 'New Name',
        username: 'archan',
        bio: 'New bio',
        city: 'Lyon',
      });
      expect(mockRouter.replace).not.toHaveBeenCalled();
    });

    it('replaces to the Profile tab on save when there is nothing to go back to', async () => {
      mockRouter.canGoBack.mockReturnValue(false);
      await renderLoaded();
      await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/profile'));
      expect(mockRouter.back).not.toHaveBeenCalled();
    });

    it('updates the cached profile so home shows the change without a restart', async () => {
      const updated = { ...profile, display_name: 'Changed' };
      mockedApi.updateMyProfile.mockResolvedValue(updated);
      const client = await renderLoaded();
      // The background refetch after save must also return the saved row.
      mockedApi.getMyProfile.mockResolvedValue(updated);
      await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
      expect(client.getQueryData(['profile', 'me'])).toEqual(updated);
      expect(client.getQueryData(['profile', 'u1'])).toEqual(updated);
    });
  });

  describe('validation', () => {
    it.each([
      ['empty display name', 'Display name', ''],
      ['whitespace display name', 'Display name', '   '],
      ['too-short username', 'Username', 'ab'],
      ['username with a space', 'Username', 'has space'],
      ['bio over 160', 'Bio', 'b'.repeat(161)],
      ['city over 60', 'City', 'c'.repeat(61)],
    ])('rejects %s without calling the api', async (_name, label, value) => {
      await renderLoaded();
      await fireEvent.changeText(screen.getByLabelText(label), value);
      await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
      expect((await screen.findAllByText(/⚠/)).length).toBeGreaterThan(0);
      expect(mockedApi.updateMyProfile).not.toHaveBeenCalled();
      expect(mockRouter.back).not.toHaveBeenCalled();
    });
  });

  describe('server errors', () => {
    it('maps username_taken to a field error, case-insensitively (Archan -> archan)', async () => {
      mockedApi.updateMyProfile.mockRejectedValue(new realApi.ProfileAppError('username_taken'));
      await renderLoaded();
      await fireEvent.changeText(screen.getByLabelText('Username'), 'Archan');
      await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByText(new RegExp(USERNAME_TAKEN))).toBeTruthy();
      expect(mockedApi.updateMyProfile).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'archan' }),
      );
      expect(screen.queryByRole('alert')).toBeNull();
      expect(mockRouter.back).not.toHaveBeenCalled();
    });

    it('shows invalid_field as a field error on that field', async () => {
      mockedApi.updateMyProfile.mockRejectedValue(
        new realApi.ProfileAppError('invalid_field', 'bio'),
      );
      await renderLoaded();
      await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
      expect((await screen.findAllByText(/⚠/)).length).toBeGreaterThan(0);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(mockRouter.back).not.toHaveBeenCalled();
    });

    it('shows other errors in a banner and stays on the screen', async () => {
      mockedApi.updateMyProfile.mockRejectedValue(new realApi.ProfileAppError('network'));
      await renderLoaded();
      await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(mockRouter.back).not.toHaveBeenCalled();
      expect(mockRouter.replace).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('navigates back without calling the api', async () => {
      await renderLoaded();
      await fireEvent.changeText(screen.getByLabelText('Bio'), 'unsaved');
      await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
      expect(mockRouter.back).toHaveBeenCalledTimes(1);
      expect(mockedApi.updateMyProfile).not.toHaveBeenCalled();
    });

    it('goes to the Profile tab when it cannot go back', async () => {
      mockRouter.canGoBack.mockReturnValue(false);
      await renderLoaded();
      await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
      expect(mockRouter.replace).toHaveBeenCalledWith('/profile');
      expect(mockedApi.updateMyProfile).not.toHaveBeenCalled();
    });
  });
});
