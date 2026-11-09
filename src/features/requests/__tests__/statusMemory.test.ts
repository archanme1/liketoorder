import AsyncStorage from '@react-native-async-storage/async-storage';

import type { RequestStatus } from '../schema';
import {
  MEMORY_CAP,
  baseline,
  changedCount,
  clearStatusMemory,
  loadMemory,
  markSeen,
  markSeenAt,
  peekMemory,
} from '../statusMemory';

const row = (id: string, display_status: RequestStatus) => ({ id, display_status });
const KEY = (user: string) => `liketoorder.requests.seen.v1.${user}`;
const flush = () => new Promise<void>((resolve) => setImmediate(() => resolve()));

async function stored(userId: string) {
  const raw = await AsyncStorage.getItem(KEY(userId));
  return raw === null ? null : (JSON.parse(raw) as [string, RequestStatus][]);
}

beforeEach(async () => {
  clearStatusMemory();
  // Let every write still in flight from the last test land before the phone is wiped.
  for (let i = 0; i < 3; i += 1) await flush();
  await AsyncStorage.clear();
});

describe('statusMemory', () => {
  it('is loading until the phone copy is read, then ready', async () => {
    expect(peekMemory('u1').phase).toBe('loading');
    await loadMemory('u1');
    expect(peekMemory('u1').phase).toBe('ready');
  });

  it('counts nothing for a request seen for the first time (the baseline)', async () => {
    await loadMemory('u1');
    const rows = [row('a', 'pending'), row('b', 'accepted')];
    expect(changedCount(peekMemory('u1'), rows)).toBe(0);
    baseline('u1', rows);
    expect(changedCount(peekMemory('u1'), rows)).toBe(0);
  });

  it('counts a request whose server status differs from the one last seen', async () => {
    await loadMemory('u1');
    baseline('u1', [row('a', 'pending'), row('b', 'pending')]);
    const later = [row('a', 'accepted'), row('b', 'pending'), row('c', 'declined')];
    // c is new (a baseline, not a change); a changed; b did not.
    expect(changedCount(peekMemory('u1'), later)).toBe(1);
  });

  it('counts a pending request that expired as a change (the server status, not the phone clock)', async () => {
    await loadMemory('u1');
    baseline('u1', [row('a', 'pending')]);
    expect(changedCount(peekMemory('u1'), [row('a', 'expired')])).toBe(1);
  });

  it('does not move a baseline once it is set', async () => {
    await loadMemory('u1');
    baseline('u1', [row('a', 'pending')]);
    baseline('u1', [row('a', 'accepted')]);
    expect(changedCount(peekMemory('u1'), [row('a', 'accepted')])).toBe(1);
  });

  it('markSeen clears the change and is written to the phone', async () => {
    await loadMemory('u1');
    baseline('u1', [row('a', 'pending')]);
    markSeen('u1', [row('a', 'accepted')]);
    expect(changedCount(peekMemory('u1'), [row('a', 'accepted')])).toBe(0);
    await flush();
    expect(await stored('u1')).toEqual([['a', 'accepted']]);
  });

  it('writes nothing until the phone copy was read, so a slow read is never overwritten', async () => {
    await AsyncStorage.setItem(KEY('u1'), JSON.stringify([['a', 'pending']]));
    baseline('u1', [row('a', 'accepted')]);
    markSeen('u1', [row('a', 'accepted')]);
    await flush();
    expect(await stored('u1')).toEqual([['a', 'pending']]);
    await loadMemory('u1');
    expect(changedCount(peekMemory('u1'), [row('a', 'accepted')])).toBe(1);
  });

  it('keeps what was seen across a restart', async () => {
    await AsyncStorage.setItem(KEY('u1'), JSON.stringify([['a', 'pending']]));
    await loadMemory('u1');
    expect(changedCount(peekMemory('u1'), [row('a', 'declined')])).toBe(1);
  });

  it('keeps one memory per user: another user inherits nothing', async () => {
    await loadMemory('u1');
    baseline('u1', [row('a', 'pending')]);
    await flush();
    await loadMemory('u2');
    expect(changedCount(peekMemory('u2'), [row('a', 'accepted')])).toBe(0);
    expect(await stored('u2')).toBeNull();
  });

  it('keeps only the most recent entries (the cap)', async () => {
    await loadMemory('u1');
    const rows = Array.from({ length: MEMORY_CAP + 25 }, (_, i) => row(`r${i}`, 'pending'));
    baseline('u1', rows);
    await flush();
    const saved = await stored('u1');
    expect(saved).toHaveLength(MEMORY_CAP);
    // Most recently written first: the newest id is kept, the oldest is dropped.
    expect(saved?.[0][0]).toBe(`r${MEMORY_CAP + 24}`);
    expect(saved?.some(([id]) => id === 'r0')).toBe(false);
  });

  it('forgets everything on sign-out, in memory and on the phone', async () => {
    await loadMemory('u1');
    baseline('u1', [row('a', 'pending')]);
    await flush();
    clearStatusMemory();
    await flush();
    expect(peekMemory('u1').phase).toBe('loading');
    expect(await stored('u1')).toBeNull();
  });

  it('leaves unrelated storage alone on sign-out', async () => {
    await AsyncStorage.setItem('liketoorder.map.lastRegion', 'x');
    clearStatusMemory();
    await flush();
    expect(await AsyncStorage.getItem('liketoorder.map.lastRegion')).toBe('x');
  });

  it('gives no count when the phone copy cannot be read', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    await loadMemory('u1');
    expect(peekMemory('u1').phase).toBe('failed');
    jest.restoreAllMocks();
  });

  it('keeps working in memory when a write fails', async () => {
    await loadMemory('u1');
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk'));
    baseline('u1', [row('a', 'pending')]);
    await flush();
    expect(changedCount(peekMemory('u1'), [row('a', 'accepted')])).toBe(1);
    jest.restoreAllMocks();
  });

  it('records an own cancel even before the phone copy was read, and it survives the read', async () => {
    await AsyncStorage.setItem(KEY('u1'), JSON.stringify([['a', 'pending']]));
    markSeenAt('u1', 'a', 'cancelled');
    await loadMemory('u1');
    expect(changedCount(peekMemory('u1'), [row('a', 'cancelled')])).toBe(0);
  });

  it('ignores a damaged phone copy', async () => {
    await AsyncStorage.setItem(KEY('u1'), '{"not":"a list"}');
    await loadMemory('u1');
    expect(peekMemory('u1').phase).toBe('ready');
    expect(changedCount(peekMemory('u1'), [row('a', 'accepted')])).toBe(0);
  });
});
