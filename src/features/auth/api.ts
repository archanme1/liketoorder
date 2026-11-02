import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

// Thin wrappers over supabase.auth. Never log arguments or results: they hold passwords,
// codes and session tokens.

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'weak_password'
  | 'invalid_code'
  | 'rate_limited'
  | 'network'
  | 'unknown';

export class AuthAppError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode) {
    super(code);
    this.name = 'AuthAppError';
    this.code = code;
  }
}

export function isAuthAppError(error: unknown): error is AuthAppError {
  return error instanceof AuthAppError;
}

export function mapAuthError(error: unknown): AuthAppError {
  if (isAuthAppError(error)) return error;
  if (isAuthRetryableFetchError(error)) return new AuthAppError('network');
  if (error instanceof TypeError && /network|fetch/i.test(error.message)) {
    return new AuthAppError('network');
  }
  if (!isAuthError(error)) return new AuthAppError('unknown');

  switch (error.code) {
    case 'invalid_credentials':
      return new AuthAppError('invalid_credentials');
    case 'email_not_confirmed':
      return new AuthAppError('email_not_confirmed');
    case 'weak_password':
    case 'same_password':
      return new AuthAppError('weak_password');
    case 'otp_expired':
      return new AuthAppError('invalid_code');
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return new AuthAppError('rate_limited');
    default:
      return new AuthAppError('unknown');
  }
}

/**
 * Same result for a new or an already-registered email: with confirmations on, Supabase
 * returns an obfuscated user (no identities) and no error for an existing email.
 * A rate limit is also treated as success: only an email that already received a code
 * can be rate limited, so surfacing it would reveal that the email exists.
 */
export async function signUp(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signUp({ email, password });
  if (!error || error.code === 'user_already_exists' || error.code === 'email_exists') return;
  const mapped = mapAuthError(error);
  if (mapped.code !== 'rate_limited') throw mapped;
}

/** Confirms the sign-up code. On success Supabase issues a session (SIGNED_IN). */
export async function verifyEmailCode(email: string, code: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) throw mapAuthError(error);
}

/**
 * Resends the sign-up code. Every non-network outcome is a neutral success so the
 * response never reveals whether the email is registered or already confirmed.
 */
export async function resendEmailCode(email: string): Promise<void> {
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  if (error) {
    const mapped = mapAuthError(error);
    if (mapped.code === 'network') throw mapped;
  }
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw mapAuthError(error);
}

/**
 * Revokes the session server-side when reachable; otherwise still clears it on this device
 * so sign-out (and cancelling a password reset) always works offline.
 */
export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) {
    const { error: localError } = await supabase.auth.signOut({ scope: 'local' });
    if (localError) throw mapAuthError(localError);
  }
}

/** Neutral for every email: only network failures surface. */
export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) {
    const mapped = mapAuthError(error);
    if (mapped.code === 'network') throw mapped;
  }
}

/**
 * Verifies the reset code. On success Supabase issues a recovery session and fires
 * PASSWORD_RECOVERY before this resolves; AuthProvider keeps the user out of the app
 * until updatePassword completes.
 */
export async function verifyResetCode(email: string, code: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'recovery' });
  if (error) throw mapAuthError(error);
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw mapAuthError(error);
}
