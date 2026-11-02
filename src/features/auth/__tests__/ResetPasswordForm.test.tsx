import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AuthApiError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

import * as api from '../api';
import { AuthProvider } from '../components/AuthProvider';
import { ResetPasswordForm } from '../components/ResetPasswordForm';
import { INVALID_CODE } from '../messages';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const RECOVERY_KEY = 'liketoorder.auth.isRecovering';

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { onAuthStateChange: jest.fn(), getSession: jest.fn() },
  },
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  verifyResetCode: jest.fn(),
  updatePassword: jest.fn(),
  signOut: jest.fn(),
}));

const realApi = jest.requireActual<typeof import('../api')>('../api');
const mockedApi = jest.mocked(api);
const auth = supabase.auth as unknown as Record<string, jest.Mock>;

const rx = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const session = { access_token: 't', refresh_token: 'r', user: { id: 'u1' } };

async function renderForm(props: { email?: string }, opts: { recovering: boolean }) {
  if (opts.recovering) {
    await AsyncStorage.setItem(RECOVERY_KEY, 'true');
    auth.getSession.mockResolvedValue({ data: { session } });
  }
  const client = new QueryClient({
    // gcTime Infinity: no cache-cleanup timers left running after a test.
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  await render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <ResetPasswordForm {...props} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('ResetPasswordForm', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
    auth.getSession.mockResolvedValue({ data: { session: null } });
    mockedApi.verifyResetCode.mockResolvedValue(undefined);
    mockedApi.updatePassword.mockResolvedValue(undefined);
    mockedApi.signOut.mockResolvedValue(undefined);
  });

  describe('code step', () => {
    it('shows the code field and Verify button when not recovering', async () => {
      await renderForm({ email: 'a@b.com' }, { recovering: false });
      const input = await screen.findByLabelText('Reset code');
      expect(input.props.keyboardType).toBe('number-pad');
      expect(input.props.autoComplete).toBe('one-time-code');
      expect(input.props.textContentType).toBe('oneTimeCode');
      expect(screen.getByRole('button', { name: 'Verify' })).toBeTruthy();
      expect(screen.queryByLabelText('New password')).toBeNull();
    });

    it('rejects a malformed code without calling the api', async () => {
      await renderForm({ email: 'a@b.com' }, { recovering: false });
      await fireEvent.changeText(await screen.findByLabelText('Reset code'), '12');
      await fireEvent.press(screen.getByRole('button', { name: 'Verify' }));
      expect((await screen.findAllByText(/⚠/)).length).toBeGreaterThan(0);
      expect(mockedApi.verifyResetCode).not.toHaveBeenCalled();
    });

    it('verifies the code for the email, then moves to the password step', async () => {
      await renderForm({ email: 'a@b.com' }, { recovering: false });
      await fireEvent.changeText(await screen.findByLabelText('Reset code'), '123456');
      await fireEvent.press(screen.getByRole('button', { name: 'Verify' }));
      expect(await screen.findByLabelText('New password')).toBeTruthy();
      expect(mockedApi.verifyResetCode).toHaveBeenCalledWith('a@b.com', '123456');
      expect(screen.queryByLabelText('Reset code')).toBeNull();
      expect(await AsyncStorage.getItem(RECOVERY_KEY)).toBe('true');
    });

    it('shows "That code isn’t right" for an invalid code and stays on the code step', async () => {
      mockedApi.verifyResetCode.mockRejectedValue(
        realApi.mapAuthError(new AuthApiError('expired', 403, 'otp_expired')),
      );
      await renderForm({ email: 'a@b.com' }, { recovering: false });
      await fireEvent.changeText(await screen.findByLabelText('Reset code'), '123456');
      await fireEvent.press(screen.getByRole('button', { name: 'Verify' }));
      expect(await screen.findByText(rx(INVALID_CODE))).toBeTruthy();
      expect(screen.queryByLabelText('New password')).toBeNull();
    });

    it('shows a fallback with a Reset password button when there is no email', async () => {
      await renderForm({}, { recovering: false });
      expect(await screen.findByRole('button', { name: 'Reset password' })).toBeTruthy();
      expect(screen.queryByLabelText('Reset code')).toBeNull();
      expect(screen.queryByLabelText('New password')).toBeNull();
    });
  });

  describe('password step', () => {
    it('shows the new password fields while recovering', async () => {
      await renderForm({ email: 'a@b.com' }, { recovering: true });
      const password = await screen.findByLabelText('New password');
      expect(password.props.secureTextEntry).toBe(true);
      expect(password.props.autoComplete).toBe('new-password');
      expect(password.props.textContentType).toBeTruthy();
      expect(screen.getByLabelText('Confirm new password')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Save password' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
      expect(screen.queryByLabelText('Reset code')).toBeNull();
    });

    it.each([
      ['weak', 'abcdefgh', 'abcdefgh'],
      ['mismatched', 'abcdefg1', 'abcdefg2'],
    ])('rejects a %s password without calling the api', async (_n, password, confirm) => {
      await renderForm({ email: 'a@b.com' }, { recovering: true });
      await fireEvent.changeText(await screen.findByLabelText('New password'), password);
      await fireEvent.changeText(screen.getByLabelText('Confirm new password'), confirm);
      await fireEvent.press(screen.getByRole('button', { name: 'Save password' }));
      expect((await screen.findAllByText(/⚠/)).length).toBeGreaterThan(0);
      expect(mockedApi.updatePassword).not.toHaveBeenCalled();
    });

    it('saves the password, leaves recovery and clears the persisted flag', async () => {
      await renderForm({ email: 'a@b.com' }, { recovering: true });
      await fireEvent.changeText(await screen.findByLabelText('New password'), 'abcdefg1');
      await fireEvent.changeText(screen.getByLabelText('Confirm new password'), 'abcdefg1');
      await fireEvent.press(screen.getByRole('button', { name: 'Save password' }));
      await waitFor(() => expect(mockedApi.updatePassword).toHaveBeenCalledWith('abcdefg1'));
      await waitFor(async () => expect(await AsyncStorage.getItem(RECOVERY_KEY)).toBeNull());
      await waitFor(() => expect(screen.queryByLabelText('New password')).toBeNull());
    });

    it('Cancel calls sign-out', async () => {
      await renderForm({ email: 'a@b.com' }, { recovering: true });
      await fireEvent.press(await screen.findByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(mockedApi.signOut).toHaveBeenCalledTimes(1));
      expect(mockedApi.updatePassword).not.toHaveBeenCalled();
    });
  });
});
