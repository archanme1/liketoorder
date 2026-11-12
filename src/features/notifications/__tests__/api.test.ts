import { supabase } from '@/lib/supabase';

import {
  NotificationAppError,
  getNotificationSettings,
  mapNotificationError,
  registerPushToken,
  setNotificationSettings,
  unregisterPushToken,
} from '../api';

import { TEST_TOKEN } from '../__fixtures__/notifications';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const db = supabase as unknown as { rpc: jest.Mock };
const SERVER_ROW = { answers: true, new_requests: false, cancellations: true, arrivals: true };

beforeEach(() => {
  db.rpc.mockReset();
});

describe('mapNotificationError', () => {
  it.each(['not_signed_in', 'invalid_input'])('keeps the server code %s', (message) => {
    expect(mapNotificationError({ code: 'P0001', message }).code).toBe(message);
  });

  it('maps a fetch failure to network', () => {
    expect(mapNotificationError({ message: 'TypeError: Network request failed' }).code).toBe(
      'network',
    );
  });

  it('never carries an unknown server message', () => {
    const mapped = mapNotificationError({ code: 'P0001', message: `token ${TEST_TOKEN}` });
    expect(mapped.code).toBe('unknown');
    expect(mapped.message).not.toContain(TEST_TOKEN);
  });
});

describe('registerPushToken / unregisterPushToken', () => {
  it('sends the token and platform', async () => {
    db.rpc.mockResolvedValueOnce({ data: null, error: null });
    await registerPushToken(TEST_TOKEN, 'ios');
    expect(db.rpc).toHaveBeenCalledWith('register_push_token', {
      p_token: TEST_TOKEN,
      p_platform: 'ios',
    });
  });

  it('throws a coded error', async () => {
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'invalid_input' },
    });
    await expect(registerPushToken(TEST_TOKEN, 'ios')).rejects.toEqual(
      new NotificationAppError('invalid_input'),
    );
  });

  it('unregisters by token', async () => {
    db.rpc.mockResolvedValueOnce({ data: null, error: null });
    await unregisterPushToken(TEST_TOKEN);
    expect(db.rpc).toHaveBeenCalledWith('unregister_push_token', { p_token: TEST_TOKEN });
  });
});

describe('settings', () => {
  it('reads the four switches', async () => {
    db.rpc.mockResolvedValueOnce({ data: SERVER_ROW, error: null });
    await expect(getNotificationSettings()).resolves.toEqual({
      answers: true,
      newRequests: false,
      cancellations: true,
      arrivals: true,
    });
  });

  it('saves all four switches at once', async () => {
    db.rpc.mockResolvedValueOnce({ data: SERVER_ROW, error: null });
    await setNotificationSettings({
      answers: true,
      newRequests: false,
      cancellations: true,
      arrivals: true,
    });
    expect(db.rpc).toHaveBeenCalledWith('set_notification_settings', {
      p_answers: true,
      p_new_requests: false,
      p_cancellations: true,
      p_arrivals: true,
    });
  });

  it('refuses a malformed answer', async () => {
    db.rpc.mockResolvedValueOnce({ data: { answers: true }, error: null });
    await expect(getNotificationSettings()).rejects.toEqual(new NotificationAppError('unknown'));
  });
});
