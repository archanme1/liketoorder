import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

import * as api from '../api';
import { VerifyEmailForm } from '../components/VerifyEmailForm';
import { INVALID_CODE, RESEND_DONE, VERIFY_EMAIL_HINT } from '../messages';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: {} } }));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  verifyEmailCode: jest.fn(),
  resendEmailCode: jest.fn(),
}));

const realApi = jest.requireActual<typeof import('../api')>('../api');
const mockedApi = jest.mocked(api);

const rx = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

async function renderForm(email = 'a@b.com', codeJustSent?: boolean) {
  const client = new QueryClient({
    // gcTime Infinity: no cache-cleanup timers left running after a test.
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  await render(
    <QueryClientProvider client={client}>
      <VerifyEmailForm email={email} codeJustSent={codeJustSent} />
    </QueryClientProvider>,
  );
}

async function tick(seconds: number) {
  for (let i = 0; i < seconds; i += 1) {
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
  }
}

describe('VerifyEmailForm', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockedApi.verifyEmailCode.mockResolvedValue(undefined);
    mockedApi.resendEmailCode.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders the code field configured for one-time codes', async () => {
    await renderForm();
    const input = screen.getByLabelText('Confirmation code');
    expect(input.props.keyboardType).toBe('number-pad');
    expect(input.props.autoComplete).toBe('one-time-code');
    expect(input.props.textContentType).toBe('oneTimeCode');
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
  });

  describe('resend cooldown', () => {
    it('starts at 60 seconds, disabled, with a text countdown', async () => {
      await renderForm();
      expect(screen.getByText('Resend code in 60s')).toBeTruthy();
      const button = screen.getByRole('button', { name: 'Resend code, available in 60 seconds' });
      expect(button).toBeDisabled();
      await fireEvent.press(button);
      expect(mockedApi.resendEmailCode).not.toHaveBeenCalled();
    });

    it('counts down each second', async () => {
      await renderForm();
      await tick(1);
      expect(screen.getByText('Resend code in 59s')).toBeTruthy();
      await tick(9);
      expect(screen.getByText('Resend code in 50s')).toBeTruthy();
      expect(
        screen.getByRole('button', { name: 'Resend code, available in 50 seconds' }),
      ).toBeDisabled();
    });

    it('enables resend after 60 seconds', async () => {
      await renderForm();
      await tick(60);
      const button = screen.getByRole('button', { name: 'Resend code' });
      expect(button).not.toBeDisabled();
      expect(screen.queryByText(/Resend code in/)).toBeNull();
    });

    it('lets the user resend straight away when no code was just sent (from sign-in)', async () => {
      await renderForm('a@b.com', false);
      expect(screen.queryByText(/Resend code in/)).toBeNull();
      expect(screen.queryByText(/We sent a 6-digit code/)).toBeNull();
      const button = screen.getByRole('button', { name: 'Resend code' });
      expect(button).not.toBeDisabled();
      await fireEvent.press(button);
      expect(await screen.findByText(rx(RESEND_DONE))).toBeTruthy();
      expect(mockedApi.resendEmailCode).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Resend code in 60s')).toBeTruthy();
    });

    it('resends, restarts the cooldown at 60 and shows the neutral confirmation', async () => {
      await renderForm('Me@Example.com');
      await tick(60);
      await fireEvent.press(screen.getByRole('button', { name: 'Resend code' }));
      expect(await screen.findByText(rx(RESEND_DONE))).toBeTruthy();
      expect(mockedApi.resendEmailCode).toHaveBeenCalledTimes(1);
      expect(mockedApi.resendEmailCode.mock.calls[0][0].toLowerCase()).toBe('me@example.com');
      expect(screen.getByText('Resend code in 60s')).toBeTruthy();
      expect(screen.getByRole('alert')).toBeTruthy();
    });

    it('shows the same neutral result for any email', async () => {
      await renderForm('known@example.com');
      await tick(60);
      await fireEvent.press(screen.getByRole('button', { name: 'Resend code' }));
      const first = (await screen.findByText(rx(RESEND_DONE))).props.children;
      await screen.unmount();

      await renderForm('unknown@example.com');
      await tick(60);
      await fireEvent.press(screen.getByRole('button', { name: 'Resend code' }));
      const second = (await screen.findByText(rx(RESEND_DONE))).props.children;
      expect(second).toEqual(first);
    });

    it('shows a banner (not the success copy) on a network error', async () => {
      mockedApi.resendEmailCode.mockRejectedValue(
        realApi.mapAuthError(new AuthRetryableFetchError('offline', 0)),
      );
      await renderForm();
      await tick(60);
      await fireEvent.press(screen.getByRole('button', { name: 'Resend code' }));
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.queryByText(rx(RESEND_DONE))).toBeNull();
    });
  });

  describe('confirming', () => {
    it('rejects a malformed code without calling the api', async () => {
      await renderForm();
      await fireEvent.changeText(screen.getByLabelText('Confirmation code'), '12');
      await fireEvent.press(screen.getByRole('button', { name: 'Confirm' }));
      expect((await screen.findAllByText(/⚠/)).length).toBeGreaterThan(0);
      expect(mockedApi.verifyEmailCode).not.toHaveBeenCalled();
    });

    it('verifies the code for the email and does not navigate on success', async () => {
      await renderForm('a@b.com');
      await fireEvent.changeText(screen.getByLabelText('Confirmation code'), '123456');
      await fireEvent.press(screen.getByRole('button', { name: 'Confirm' }));
      await screen.findByRole('button', { name: 'Confirm' });
      expect(mockedApi.verifyEmailCode).toHaveBeenCalledWith('a@b.com', '123456');
      expect(mockRouter.push).not.toHaveBeenCalled();
      expect(mockRouter.replace).not.toHaveBeenCalled();
    });

    it('shows "That code isn’t right" as a field error for an invalid code', async () => {
      mockedApi.verifyEmailCode.mockRejectedValue(
        realApi.mapAuthError(new AuthApiError('expired', 403, 'otp_expired')),
      );
      await renderForm();
      await fireEvent.changeText(screen.getByLabelText('Confirmation code'), '123456');
      await fireEvent.press(screen.getByRole('button', { name: 'Confirm' }));
      expect(await screen.findByText(rx(INVALID_CODE))).toBeTruthy();
    });
  });

  describe('neutral hint', () => {
    it('shows the hint with sign-in and reset-password links', async () => {
      await renderForm();
      expect(screen.getByText(rx(VERIFY_EMAIL_HINT))).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
      expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in');
      await fireEvent.press(screen.getByRole('button', { name: 'Reset password' }));
      expect(mockRouter.replace).toHaveBeenCalledWith('/forgot-password');
    });

    it('renders identical hint text for a new and an existing email', async () => {
      await renderForm('new@example.com');
      const first = screen.getByText(rx(VERIFY_EMAIL_HINT)).props.children;
      await screen.unmount();
      await renderForm('existing@example.com');
      const second = screen.getByText(rx(VERIFY_EMAIL_HINT)).props.children;
      expect(second).toEqual(first);
    });
  });
});
