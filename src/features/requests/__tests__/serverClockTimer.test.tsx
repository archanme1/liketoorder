import { act, cleanup, renderHook } from '@testing-library/react-native';

import { useArrivalWindow } from '../hooks/useArrivalWindow';
import { MAX_TIMER_MS } from '../hooks/useServerClockReading';
import { usePickupPassed } from '../hooks/usePickupPassed';

const DAY = 24 * 3_600_000;
const NOW = Date.parse('2026-11-08T17:00:00Z');
const SERVER_NOW = '2026-11-08T17:00:00Z';
// setTimeout cannot wait longer than 2^31 - 1 ms (about 24.8 days): longer fires at once.
const JS_TIMER_LIMIT = 2 ** 31 - 1;

let timerSpy: jest.SpyInstance;
const delays = () => timerSpy.mock.calls.map(([, delay]) => Number(delay));

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  jest.setSystemTime(NOW);
  timerSpy = jest.spyOn(globalThis, 'setTimeout');
});

afterEach(async () => {
  await cleanup();
  timerSpy.mockRestore();
  jest.useRealTimers();
});

describe('a table 29 days away (further than a timer can wait)', () => {
  const tableAt = new Date(NOW + 29 * DAY).toISOString();

  it('usePickupPassed does not re-render in a loop, and never asks for an impossible wait', async () => {
    let renders = 0;
    const { result } = await renderHook(() => {
      renders += 1;
      return usePickupPassed(tableAt, SERVER_NOW, NOW);
    });
    expect(result.current).toBe(false);
    const before = renders;
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    // A timer that fired at once would re-render again and again within these 10 seconds.
    expect(renders - before).toBeLessThanOrEqual(1);
    for (const delay of delays()) expect(delay).toBeLessThanOrEqual(JS_TIMER_LIMIT);
    expect(Math.max(...delays())).toBe(MAX_TIMER_MS);
  });

  it('looks again after the capped wait and keeps waiting for the rest', async () => {
    const { result } = await renderHook(() => usePickupPassed(tableAt, SERVER_NOW, NOW));
    await act(async () => {
      jest.advanceTimersByTime(MAX_TIMER_MS + 5);
    });
    expect(result.current).toBe(false);
    // 29 days is 2.5e9 ms: about 5e8 ms are left, and the next timer waits for exactly that.
    const rest = new Date(tableAt).getTime() - (NOW + MAX_TIMER_MS + 5);
    expect(delays().some((delay) => Math.abs(delay - rest) < 100)).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(rest + 10);
    });
    expect(result.current).toBe(true);
  });

  it('useArrivalWindow is capped the same way', async () => {
    let renders = 0;
    const { result } = await renderHook(() => {
      renders += 1;
      return useArrivalWindow(tableAt, SERVER_NOW, NOW);
    });
    expect(result.current).toBe('before');
    const before = renders;
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(renders - before).toBeLessThanOrEqual(1);
    for (const delay of delays()) expect(delay).toBeLessThanOrEqual(JS_TIMER_LIMIT);
  });
});

describe('a time that has already passed', () => {
  it('needs no timer at all', async () => {
    const past = new Date(NOW - DAY).toISOString();
    const { result } = await renderHook(() => usePickupPassed(past, SERVER_NOW, NOW));
    expect(result.current).toBe(true);
    expect(timerSpy).not.toHaveBeenCalled();
  });

  it('a wrong phone clock does not decide: the server time does', async () => {
    // The phone says it is a year later, but it read the server clock at the same moment.
    const tableAt = new Date(NOW + DAY).toISOString();
    jest.setSystemTime(NOW + 365 * DAY);
    const { result } = await renderHook(() =>
      usePickupPassed(tableAt, SERVER_NOW, NOW + 365 * DAY),
    );
    expect(result.current).toBe(false);
  });
});
