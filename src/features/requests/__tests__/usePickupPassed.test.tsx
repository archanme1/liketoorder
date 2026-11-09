import { act, cleanup, renderHook } from '@testing-library/react-native';

import { usePickupPassed } from '../hooks/usePickupPassed';

// The server says it is 17:00:00Z when the data arrives. The phone's clock may disagree.
const SERVER_NOW = '2026-11-08T17:00:00Z';
const HOUR = 3_600_000;

afterEach(async () => {
  jest.useRealTimers();
  await cleanup();
});

function at(phoneNow: string) {
  jest.useFakeTimers({ now: new Date(phoneNow) });
  return Date.now(); // fetchedAt: the phone's own reading at arrival
}

describe('usePickupPassed (server clock, a hint only)', () => {
  it('is false until there is a server time', async () => {
    at(SERVER_NOW);
    const { result } = await renderHook(() =>
      usePickupPassed('2026-11-08T16:00:00Z', undefined, 0),
    );
    expect(result.current).toBe(false);
  });

  it('is true when the pickup time is past on the server clock', async () => {
    const fetchedAt = at(SERVER_NOW);
    const { result } = await renderHook(() =>
      usePickupPassed('2026-11-08T16:45:00Z', SERVER_NOW, fetchedAt),
    );
    expect(result.current).toBe(true);
  });

  it('a phone 2 h AHEAD does not show the buttons early', async () => {
    const fetchedAt = at('2026-11-08T19:00:00Z');
    const { result } = await renderHook(() =>
      usePickupPassed('2026-11-08T17:30:00Z', SERVER_NOW, fetchedAt),
    );
    // On the phone's own clock 17:30 is long gone; on the server's it is 30 minutes away.
    expect(result.current).toBe(false);
  });

  it('a phone 2 h BEHIND still shows them once the server clock says the time has passed', async () => {
    const fetchedAt = at('2026-11-08T15:00:00Z');
    const { result } = await renderHook(() =>
      usePickupPassed('2026-11-08T16:30:00Z', SERVER_NOW, fetchedAt),
    );
    expect(result.current).toBe(true);
  });

  it('flips by itself when the pickup time arrives', async () => {
    const fetchedAt = at('2026-11-08T19:00:00Z'); // phone 2 h ahead
    const { result } = await renderHook(() =>
      usePickupPassed('2026-11-08T17:30:00Z', SERVER_NOW, fetchedAt),
    );
    expect(result.current).toBe(false);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(HOUR / 2 - 1_000);
    });
    expect(result.current).toBe(false);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_000);
    });
    expect(result.current).toBe(true);
  });

  it('stops its timer when unmounted', async () => {
    const fetchedAt = at(SERVER_NOW);
    const { unmount } = await renderHook(() =>
      usePickupPassed('2026-11-08T18:00:00Z', SERVER_NOW, fetchedAt),
    );
    const cleared = jest.spyOn(globalThis, 'clearTimeout');
    await unmount();
    expect(cleared).toHaveBeenCalled();
    cleared.mockRestore();
  });

  it('if the timer fires a little early, it arms again for the rest instead of waiting for a refetch', async () => {
    // Only the timers are fake; the clock is a variable, so the timer can fire "early".
    jest.useFakeTimers({ doNotFake: ['Date'] });
    let clock = Date.parse(SERVER_NOW);
    const now = jest.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      const pickup = new Date(clock + 10_000).toISOString();
      const fetchedAt = clock; // fixed when the data arrived; only the phone's clock moves on
      const { result } = await renderHook(() => usePickupPassed(pickup, SERVER_NOW, fetchedAt));
      expect(result.current).toBe(false);

      clock = Date.parse(pickup) - 5; // 5 ms short of the pickup time when the timer fires
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10_001);
      });
      expect(result.current).toBe(false);

      clock = Date.parse(pickup) + 1;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(20);
      });
      expect(result.current).toBe(true);
    } finally {
      now.mockRestore();
    }
  });
});
