import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

import {
  AuthAppError,
  isAuthAppError,
  mapAuthError,
  requestPasswordReset,
  resendEmailCode,
  signIn,
  signOut,
  signUp,
  updatePassword,
  verifyEmailCode,
  verifyResetCode,
} from '../api';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signUp: jest.fn(),
      verifyOtp: jest.fn(),
      resend: jest.fn(),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      resetPasswordForEmail: jest.fn(),
      updateUser: jest.fn(),
    },
  },
}));

const auth = supabase.auth as unknown as Record<string, jest.Mock>;

const apiError = (code: string, status = 400) => new AuthApiError(`msg ${code}`, status, code);
const networkError = () => new AuthRetryableFetchError('offline', 0);

describe('mapAuthError', () => {
  it.each([
    ['invalid_credentials', 'invalid_credentials'],
    ['email_not_confirmed', 'email_not_confirmed'],
    ['weak_password', 'weak_password'],
    ['otp_expired', 'invalid_code'],
    ['over_email_send_rate_limit', 'rate_limited'],
    ['over_request_rate_limit', 'rate_limited'],
  ])('maps supabase code %s to %s', (supabaseCode, appCode) => {
    const mapped = mapAuthError(apiError(supabaseCode));
    expect(mapped).toBeInstanceOf(AuthAppError);
    expect(isAuthAppError(mapped)).toBe(true);
    expect(mapped.code).toBe(appCode);
  });

  it('maps a retryable fetch error to network', () => {
    expect(mapAuthError(networkError()).code).toBe('network');
  });

  it('maps anything else to unknown', () => {
    expect(mapAuthError(new Error('boom')).code).toBe('unknown');
    expect(mapAuthError('weird').code).toBe('unknown');
    expect(mapAuthError(apiError('some_new_code', 500)).code).toBe('unknown');
  });

  it('isAuthAppError is false for plain errors', () => {
    expect(isAuthAppError(new Error('x'))).toBe(false);
    expect(isAuthAppError(null)).toBe(false);
  });
});

describe('auth api', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    for (const fn of Object.values(auth)) fn.mockResolvedValue({ data: {}, error: null });
  });

  afterEach(() => {
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  describe('signUp', () => {
    it('calls supabase with the email and password and resolves void', async () => {
      auth.signUp.mockResolvedValue({
        data: { user: { identities: [{ id: 'x' }] }, session: null },
        error: null,
      });
      await expect(signUp('a@b.com', 'abcdefg1')).resolves.toBeUndefined();
      expect(auth.signUp).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'a@b.com', password: 'abcdefg1' }),
      );
    });

    it('resolves the same way for an existing email (user without identities)', async () => {
      auth.signUp.mockResolvedValue({
        data: { user: { identities: [] }, session: null },
        error: null,
      });
      await expect(signUp('taken@b.com', 'abcdefg1')).resolves.toBeUndefined();
    });

    it('resolves for a rate-limit error', async () => {
      auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: apiError('over_email_send_rate_limit', 429),
      });
      await expect(signUp('a@b.com', 'abcdefg1')).resolves.toBeUndefined();
    });

    it('resolves for an already-registered error code', async () => {
      auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: apiError('user_already_exists', 422),
      });
      await expect(signUp('a@b.com', 'abcdefg1')).resolves.toBeUndefined();
    });

    it('throws weak_password', async () => {
      auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: apiError('weak_password', 422),
      });
      await expect(signUp('a@b.com', 'abc')).rejects.toMatchObject({ code: 'weak_password' });
    });

    it('throws network errors', async () => {
      auth.signUp.mockResolvedValue({ data: { user: null, session: null }, error: networkError() });
      await expect(signUp('a@b.com', 'abcdefg1')).rejects.toMatchObject({ code: 'network' });
    });
  });

  describe('verifyEmailCode', () => {
    it('verifies with the email OTP type', async () => {
      await expect(verifyEmailCode('a@b.com', '123456')).resolves.toBeUndefined();
      expect(auth.verifyOtp).toHaveBeenCalledWith({
        email: 'a@b.com',
        token: '123456',
        type: 'email',
      });
    });

    it('throws invalid_code for an expired or wrong code', async () => {
      auth.verifyOtp.mockResolvedValue({ data: {}, error: apiError('otp_expired', 403) });
      await expect(verifyEmailCode('a@b.com', '123456')).rejects.toMatchObject({
        code: 'invalid_code',
      });
    });
  });

  describe('resendEmailCode', () => {
    it('resends a signup code for the email', async () => {
      await expect(resendEmailCode('a@b.com')).resolves.toBeUndefined();
      expect(auth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'a@b.com' });
    });

    it.each(['over_email_send_rate_limit', 'user_already_exists', 'some_unknown_code'])(
      'resolves (neutral) for error %s',
      async (code) => {
        auth.resend.mockResolvedValue({ data: {}, error: apiError(code, 429) });
        await expect(resendEmailCode('a@b.com')).resolves.toBeUndefined();
      },
    );

    it('throws only for network errors', async () => {
      auth.resend.mockResolvedValue({ data: {}, error: networkError() });
      await expect(resendEmailCode('a@b.com')).rejects.toMatchObject({ code: 'network' });
    });
  });

  describe('signIn', () => {
    it('signs in with password and resolves void', async () => {
      await expect(signIn('a@b.com', 'abcdefg1')).resolves.toBeUndefined();
      expect(auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'a@b.com',
        password: 'abcdefg1',
      });
    });

    it.each(['invalid_credentials', 'email_not_confirmed'])('throws %s', async (code) => {
      auth.signInWithPassword.mockResolvedValue({ data: {}, error: apiError(code) });
      await expect(signIn('a@b.com', 'x')).rejects.toMatchObject({ code });
    });

    it('throws an AuthAppError instance', async () => {
      auth.signInWithPassword.mockResolvedValue({
        data: {},
        error: apiError('invalid_credentials'),
      });
      await expect(signIn('a@b.com', 'x')).rejects.toBeInstanceOf(AuthAppError);
    });
  });

  describe('signOut', () => {
    it('signs out once when it succeeds', async () => {
      await expect(signOut()).resolves.toBeUndefined();
      expect(auth.signOut).toHaveBeenCalledTimes(1);
    });

    it('falls back to a local sign-out when the first call returns an error', async () => {
      auth.signOut
        .mockResolvedValueOnce({ error: networkError() })
        .mockResolvedValueOnce({ error: null });
      await expect(signOut()).resolves.toBeUndefined();
      expect(auth.signOut).toHaveBeenCalledTimes(2);
      expect(auth.signOut).toHaveBeenLastCalledWith({ scope: 'local' });
    });
  });

  describe('requestPasswordReset', () => {
    it('requests a reset for the email', async () => {
      await expect(requestPasswordReset('a@b.com')).resolves.toBeUndefined();
      expect(auth.resetPasswordForEmail.mock.calls[0][0]).toBe('a@b.com');
    });

    it.each(['over_email_send_rate_limit', 'user_not_found', 'some_unknown_code'])(
      'resolves (neutral) for error %s',
      async (code) => {
        auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: apiError(code, 400) });
        await expect(requestPasswordReset('a@b.com')).resolves.toBeUndefined();
      },
    );

    it('throws only for network errors', async () => {
      auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: networkError() });
      await expect(requestPasswordReset('a@b.com')).rejects.toMatchObject({ code: 'network' });
    });
  });

  describe('verifyResetCode', () => {
    it('verifies with the recovery OTP type', async () => {
      await expect(verifyResetCode('a@b.com', '123456')).resolves.toBeUndefined();
      expect(auth.verifyOtp).toHaveBeenCalledWith({
        email: 'a@b.com',
        token: '123456',
        type: 'recovery',
      });
    });

    it('throws invalid_code for a wrong or expired code', async () => {
      auth.verifyOtp.mockResolvedValue({ data: {}, error: apiError('otp_expired', 403) });
      await expect(verifyResetCode('a@b.com', '123456')).rejects.toMatchObject({
        code: 'invalid_code',
      });
    });
  });

  describe('updatePassword', () => {
    it('updates the user password', async () => {
      await expect(updatePassword('abcdefg1')).resolves.toBeUndefined();
      expect(auth.updateUser).toHaveBeenCalledWith({ password: 'abcdefg1' });
    });

    it('throws weak_password', async () => {
      auth.updateUser.mockResolvedValue({ data: {}, error: apiError('weak_password', 422) });
      await expect(updatePassword('abc')).rejects.toMatchObject({ code: 'weak_password' });
    });
  });
});
