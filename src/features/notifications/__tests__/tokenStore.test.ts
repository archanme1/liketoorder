import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/lib/supabase';

import { NotificationAppError } from '../api';
import { TOKEN_KEY, readStoredToken, saveStoredToken, unregisterThisPhone } from '../tokenStore';

import { TEST_TOKEN } from '../__fixtures__/notifications';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const db = supabase as unknown as { rpc: jest.Mock };

beforeEach(async () => {
  await AsyncStorage.clear();
  db.rpc.mockReset();
  db.rpc.mockResolvedValue({ data: null, error: null });
});

describe('the stored token', () => {
  it('round-trips a valid token', async () => {
    await saveStoredToken(TEST_TOKEN);
    await expect(readStoredToken()).resolves.toBe(TEST_TOKEN);
  });

  it('ignores anything that is not a push token', async () => {
    await AsyncStorage.setItem(TOKEN_KEY, 'garbage');
    await expect(readStoredToken()).resolves.toBeNull();
  });

  it('reads as none when storage fails', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    await expect(readStoredToken()).resolves.toBeNull();
  });
});

describe('unregisterThisPhone', () => {
  it('does nothing when this phone never registered', async () => {
    await unregisterThisPhone();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('removes the stored token from the signed-in user, then forgets it', async () => {
    await saveStoredToken(TEST_TOKEN);
    await unregisterThisPhone();
    expect(db.rpc).toHaveBeenCalledWith('unregister_push_token', { p_token: TEST_TOKEN });
    await expect(readStoredToken()).resolves.toBeNull();
  });

  it('keeps the token and resolves when the server refuses', async () => {
    await saveStoredToken(TEST_TOKEN);
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'not_signed_in' },
    });
    await expect(unregisterThisPhone()).resolves.toBeUndefined();
    await expect(readStoredToken()).resolves.toBe(TEST_TOKEN);
  });

  it('resolves when the network fails', async () => {
    await saveStoredToken(TEST_TOKEN);
    db.rpc.mockRejectedValueOnce(new NotificationAppError('network'));
    await expect(unregisterThisPhone()).resolves.toBeUndefined();
  });

  it('gives up after the timeout when the server never answers', async () => {
    await saveStoredToken(TEST_TOKEN);
    db.rpc.mockReturnValueOnce(new Promise(() => undefined));
    await expect(unregisterThisPhone(20)).resolves.toBeUndefined();
  });
});
