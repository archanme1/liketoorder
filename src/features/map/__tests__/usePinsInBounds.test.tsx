import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { fetchPinsInBounds, MapAppError } from '../api';
import { usePinsInBounds } from '../hooks/usePinsInBounds';
import type { MapBox } from '../region';
import type { Pin, PinsResponse } from '../schema';

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  fetchPinsInBounds: jest.fn(),
}));

const fetchPins = jest.mocked(fetchPinsInBounds);

const boxA: MapBox = { minLat: 43.1, maxLat: 43.9, minLng: -79.9, maxLng: -79.1 };
const boxB: MapBox = { minLat: 45.1, maxLat: 45.9, minLng: -75.9, maxLng: -75.1 };

function pin(id: string): Pin {
  return { id, name: id, cuisine_code: 'IT', lat: 43.5, lng: -79.4 };
}
function answer(...ids: string[]): PinsResponse {
  return { pins: ids.map(pin), capped: false, too_large: false };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function setup(box: MapBox | null) {
  return renderHook((props: { box: MapBox | null }) => usePinsInBounds(props.box), {
    wrapper,
    initialProps: { box },
  });
}
const ids = (hook: { current: ReturnType<typeof usePinsInBounds> }) =>
  hook.current.pins.map((p) => p.id);

afterEach(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  fetchPins.mockReset();
});

describe('usePinsInBounds', () => {
  it('sends no request without a box', async () => {
    const { result } = await setup(null);
    await act(async () => undefined);
    expect(fetchPins).not.toHaveBeenCalled();
    expect(result.current.pins).toEqual([]);
    expect(result.current.hasData).toBe(false);
  });

  it('loads the pins for the box', async () => {
    fetchPins.mockResolvedValue({ pins: [pin('a')], capped: true, too_large: false });
    const { result } = await setup(boxA);
    await waitFor(() => expect(ids(result)).toEqual(['a']));
    expect(result.current.capped).toBe(true);
    expect(result.current.tooLarge).toBe(false);
    expect(fetchPins).toHaveBeenCalledTimes(1);
  });

  it('reports a too_large answer', async () => {
    fetchPins.mockResolvedValue({ pins: [], capped: false, too_large: true });
    const { result } = await setup(boxA);
    await waitFor(() => expect(result.current.tooLarge).toBe(true));
  });

  it('rounds the box to 3 decimals, so tiny pans share one request', async () => {
    fetchPins.mockResolvedValue(answer('a'));
    const { result, rerender } = await setup({ ...boxA, minLat: 43.1001 });
    await waitFor(() => expect(ids(result)).toEqual(['a']));
    await rerender({ box: { ...boxA, minLat: 43.1002 } });
    await act(async () => undefined);
    expect(fetchPins).toHaveBeenCalledTimes(1);
    expect(fetchPins).toHaveBeenCalledWith({ ...boxA, minLat: 43.1 });
  });

  it('asks again when the box really changes', async () => {
    fetchPins.mockResolvedValueOnce(answer('a')).mockResolvedValueOnce(answer('b'));
    const { result, rerender } = await setup(boxA);
    await waitFor(() => expect(ids(result)).toEqual(['a']));
    await rerender({ box: boxB });
    await waitFor(() => expect(ids(result)).toEqual(['b']));
    expect(fetchPins).toHaveBeenCalledTimes(2);
  });

  it('keeps the old pins on screen while the next area loads', async () => {
    const next = deferred<PinsResponse>();
    fetchPins.mockResolvedValueOnce(answer('a')).mockReturnValueOnce(next.promise);
    const { result, rerender } = await setup(boxA);
    await waitFor(() => expect(ids(result)).toEqual(['a']));
    await rerender({ box: boxB });
    expect(result.current.isFetching).toBe(true);
    expect(ids(result)).toEqual(['a']); // no flicker to empty
    await act(async () => next.resolve(answer('b')));
    await waitFor(() => expect(ids(result)).toEqual(['b']));
  });

  it('ignores a late answer for an old area', async () => {
    const slowA = deferred<PinsResponse>();
    fetchPins.mockReturnValueOnce(slowA.promise).mockResolvedValueOnce(answer('b'));
    const { result, rerender } = await setup(boxA);
    await rerender({ box: boxB });
    await waitFor(() => expect(ids(result)).toEqual(['b']));
    await act(async () => slowA.resolve(answer('a')));
    expect(ids(result)).toEqual(['b']);
  });

  describe('rate_limited', () => {
    it('is never retried, keeps the old pins and is reported', async () => {
      jest.useFakeTimers();
      fetchPins
        .mockResolvedValueOnce(answer('a'))
        .mockRejectedValueOnce(new MapAppError('rate_limited'));
      const { result, rerender } = await setup(boxA);
      await waitFor(() => expect(ids(result)).toEqual(['a']));
      await rerender({ box: boxB });
      await waitFor(() => expect(result.current.error?.code).toBe('rate_limited'));
      expect(ids(result)).toEqual(['a']);
      // Give a retry every chance to happen.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1300);
      });
      expect(fetchPins).toHaveBeenCalledTimes(2);
    });

    it('is not re-sent when the app regains focus or the connection returns', async () => {
      fetchPins.mockRejectedValue(new MapAppError('rate_limited'));
      const { result } = await setup(boxA);
      await waitFor(() => expect(result.current.error?.code).toBe('rate_limited'));
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await act(async () => undefined);
      expect(fetchPins).toHaveBeenCalledTimes(1);
    });

    it('is sent again only when the person asks (retry)', async () => {
      fetchPins
        .mockRejectedValueOnce(new MapAppError('rate_limited'))
        .mockResolvedValueOnce(answer('a'));
      const { result } = await setup(boxA);
      await waitFor(() => expect(result.current.error?.code).toBe('rate_limited'));
      await act(async () => result.current.retry());
      await waitFor(() => expect(ids(result)).toEqual(['a']));
      expect(result.current.error).toBeNull();
      expect(fetchPins).toHaveBeenCalledTimes(2);
    });

    it('retry stays the same function across renders', async () => {
      fetchPins.mockResolvedValue(answer('a'));
      const { result, rerender } = await setup(boxA);
      await waitFor(() => expect(ids(result)).toEqual(['a']));
      const first = result.current.retry;
      await rerender({ box: boxA });
      expect(result.current.retry).toBe(first);
    });

    it('is sent again when the box changes', async () => {
      fetchPins
        .mockRejectedValueOnce(new MapAppError('rate_limited'))
        .mockResolvedValueOnce(answer('b'));
      const { result, rerender } = await setup(boxA);
      await waitFor(() => expect(result.current.error?.code).toBe('rate_limited'));
      await rerender({ box: boxB });
      await waitFor(() => expect(ids(result)).toEqual(['b']));
      expect(result.current.error).toBeNull();
    });
  });

  it('does not retry invalid_bounds', async () => {
    jest.useFakeTimers();
    fetchPins.mockRejectedValue(new MapAppError('invalid_bounds'));
    const { result } = await setup(boxA);
    await waitFor(() => expect(result.current.error?.code).toBe('invalid_bounds'));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1300);
    });
    expect(fetchPins).toHaveBeenCalledTimes(1);
  });

  it('retries another kind of error at most once', async () => {
    jest.useFakeTimers();
    fetchPins.mockRejectedValue(new MapAppError('network'));
    const { result } = await setup(boxA);
    await waitFor(() => expect(result.current.error?.code).toBe('network'), { timeout: 4000 });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1300);
    });
    expect(fetchPins).toHaveBeenCalledTimes(2);
  });

  it('keeps the old pins after a network failure for a new area', async () => {
    fetchPins.mockResolvedValueOnce(answer('a')).mockRejectedValue(new MapAppError('unknown'));
    const { result, rerender } = await setup(boxA);
    await waitFor(() => expect(ids(result)).toEqual(['a']));
    await rerender({ box: boxB });
    await waitFor(() => expect(result.current.error?.code).toBe('unknown'), { timeout: 4000 });
    expect(ids(result)).toEqual(['a']);
  });
});
