import type { PostgrestError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

import { notificationSettingsSchema, type NotificationSettings } from './schema';

export type NotificationErrorCode = 'not_signed_in' | 'invalid_input' | 'network' | 'unknown';

const SERVER_CODES: ReadonlySet<string> = new Set<NotificationErrorCode>([
  'not_signed_in',
  'invalid_input',
]);

// Carries only a code: never a token or the upstream message.
export class NotificationAppError extends Error {
  readonly code: NotificationErrorCode;

  constructor(code: NotificationErrorCode) {
    super(code);
    this.name = 'NotificationAppError';
    this.code = code;
  }
}

/** Maps an RPC error from the notification functions to a coded error. */
export function mapNotificationError(error: unknown): NotificationAppError {
  if (error instanceof NotificationAppError) return error;
  if (!error || typeof error !== 'object') return new NotificationAppError('unknown');
  const {
    code = '',
    message = '',
    details,
  } = error as Partial<Omit<PostgrestError, 'details'> & { details: string | null }>;

  if (code === 'P0001' && SERVER_CODES.has(message)) {
    return new NotificationAppError(message as NotificationErrorCode);
  }
  if (!code && /network|fetch/i.test(`${message} ${details ?? ''}`)) {
    return new NotificationAppError('network');
  }
  return new NotificationAppError('unknown');
}

export type PushPlatform = 'ios' | 'android';

/** Links this phone's Expo push token to the signed-in user (moving it from anyone else). */
export async function registerPushToken(token: string, platform: PushPlatform): Promise<void> {
  const { error } = await supabase.rpc('register_push_token', {
    p_token: token,
    p_platform: platform,
  });
  if (error) throw mapNotificationError(error);
}

/** Removes the token if it is the signed-in user's; any other token is left alone. */
export async function unregisterPushToken(token: string): Promise<void> {
  const { error } = await supabase.rpc('unregister_push_token', { p_token: token });
  if (error) throw mapNotificationError(error);
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const { data, error } = await supabase.rpc('get_notification_settings');
  if (error) throw mapNotificationError(error);
  const parsed = notificationSettingsSchema.safeParse(data);
  if (!parsed.success) throw new NotificationAppError('unknown');
  return parsed.data;
}

/** Saves all four switches at once and returns what the server now holds. */
export async function setNotificationSettings(
  settings: NotificationSettings,
): Promise<NotificationSettings> {
  const { data, error } = await supabase.rpc('set_notification_settings', {
    p_answers: settings.answers,
    p_new_requests: settings.newRequests,
    p_cancellations: settings.cancellations,
    p_arrivals: settings.arrivals,
  });
  if (error) throw mapNotificationError(error);
  const parsed = notificationSettingsSchema.safeParse(data);
  if (!parsed.success) throw new NotificationAppError('unknown');
  return parsed.data;
}
