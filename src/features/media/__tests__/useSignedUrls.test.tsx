import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { signedUrls } from '../api';
import { useSignedUrls } from '../hooks/useSignedUrls';

jest.mock('../api');

const mockedSignedUrls = jest.mocked(signedUrls);
const MINUTE = 60 * 1000;
const BUCKET = 'business-media';

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

// react-query delivers results through its notifyManager's setTimeout(0), so under fake timers a
// flush advances 1 ms (not "all pending timers", which would also fire the stale/gc timers).
async function flush() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockedSignedUrls.mockReset();
  mockedSignedUrls.mockImplementation(async (_bucket, paths) =>
    Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])),
  );
});

afterEach(() => {
  focusManager.setFocused(undefined);
  client.clear();
  jest.useRealTimers();
});

describe('useSignedUrls', () => {
  it('asks for 3600 second URLs in one batch', async () => {
    await renderHook(() => useSignedUrls(BUCKET, ['a/1.jpg', 'a/2.jpg']), { wrapper });
    await flush();

    expect(mockedSignedUrls).toHaveBeenCalledTimes(1);
    expect(mockedSignedUrls).toHaveBeenCalledWith(BUCKET, ['a/1.jpg', 'a/2.jpg'], 3600);
  });

  it('returns undefined while loading, then the URL for each path', async () => {
    const { result } = await renderHook(() => useSignedUrls(BUCKET, ['a/1.jpg']), { wrapper });
    expect(result.current.urlFor('a/1.jpg')).toBeUndefined();
    expect(result.current.isLoading).toBe(true);

    await flush();

    expect(result.current.urlFor('a/1.jpg')).toBe('https://signed/a/1.jpg');
    expect(result.current.isLoading).toBe(false);
  });

  it('returns null for a path the server gave no URL for', async () => {
    mockedSignedUrls.mockResolvedValue({ 'a/1.jpg': 'https://signed/1', 'a/2.jpg': null });
    const { result } = await renderHook(() => useSignedUrls(BUCKET, ['a/1.jpg', 'a/2.jpg']), {
      wrapper,
    });
    await flush();

    expect(result.current.urlFor('a/1.jpg')).toBe('https://signed/1');
    expect(result.current.urlFor('a/2.jpg')).toBeNull();
  });

  it('stores the query under [media, signed, bucket, ...sortedPaths]', async () => {
    await renderHook(() => useSignedUrls(BUCKET, ['b/2.jpg', 'a/1.jpg']), { wrapper });
    await flush();

    expect(client.getQueryData(['media', 'signed', BUCKET, 'a/1.jpg', 'b/2.jpg'])).toBeDefined();
  });

  it('shares one request between two orderings of the same paths', async () => {
    await renderHook(() => useSignedUrls(BUCKET, ['b/2.jpg', 'a/1.jpg']), { wrapper });
    await flush();
    await renderHook(() => useSignedUrls(BUCKET, ['a/1.jpg', 'b/2.jpg']), { wrapper });
    await flush();

    expect(mockedSignedUrls).toHaveBeenCalledTimes(1);
  });

  it('does not refetch on remount at 49 minutes', async () => {
    const first = await renderHook(() => useSignedUrls(BUCKET, ['a/1.jpg']), { wrapper });
    await flush();
    expect(mockedSignedUrls).toHaveBeenCalledTimes(1);
    await first.unmount();

    await advance(49 * MINUTE);
    await renderHook(() => useSignedUrls(BUCKET, ['a/1.jpg']), { wrapper });
    await flush();

    expect(mockedSignedUrls).toHaveBeenCalledTimes(1);
  });

  it('refetches on remount at 51 minutes, showing the cached URL meanwhile', async () => {
    const first = await renderHook(() => useSignedUrls(BUCKET, ['a/1.jpg']), { wrapper });
    await flush();
    await first.unmount();

    await advance(51 * MINUTE);
    const second = await renderHook(() => useSignedUrls(BUCKET, ['a/1.jpg']), { wrapper });
    expect(second.result.current.urlFor('a/1.jpg')).toBe('https://signed/a/1.jpg');
    await flush();

    expect(mockedSignedUrls).toHaveBeenCalledTimes(2);
  });

  it('does not hand out an unused set of URLs after 55 minutes (starts loading again)', async () => {
    const first = await renderHook(() => useSignedUrls(BUCKET, ['a/1.jpg']), { wrapper });
    await flush();
    await first.unmount();

    await advance(56 * MINUTE);
    const second = await renderHook(() => useSignedUrls(BUCKET, ['a/1.jpg']), { wrapper });

    expect(second.result.current.urlFor('a/1.jpg')).toBeUndefined();
    await flush();
    expect(mockedSignedUrls).toHaveBeenCalledTimes(2);
  });

  it('does not refetch on focus at 49 minutes', async () => {
    await renderHook(() => useSignedUrls(BUCKET, ['a/1.jpg']), { wrapper });
    await flush();

    await advance(49 * MINUTE);
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await flush();

    expect(mockedSignedUrls).toHaveBeenCalledTimes(1);
  });

  it('refetches on focus at 51 minutes', async () => {
    await renderHook(() => useSignedUrls(BUCKET, ['a/1.jpg']), { wrapper });
    await flush();

    await advance(51 * MINUTE);
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await flush();

    expect(mockedSignedUrls).toHaveBeenCalledTimes(2);
  });

  it('fetches again when a new path appears', async () => {
    const { rerender } = await renderHook(
      ({ paths }: { paths: string[] }) => useSignedUrls(BUCKET, paths),
      { wrapper, initialProps: { paths: ['a/1.jpg'] } },
    );
    await flush();
    await rerender({ paths: ['a/1.jpg', 'a/2.jpg'] });
    await flush();

    expect(mockedSignedUrls).toHaveBeenCalledTimes(2);
    expect(mockedSignedUrls).toHaveBeenLastCalledWith(BUCKET, ['a/1.jpg', 'a/2.jpg'], 3600);
  });

  describe('renew', () => {
    it('invalidates once per path: the first call refetches, a repeat does not', async () => {
      const { result } = await renderHook(() => useSignedUrls(BUCKET, ['a/1.jpg', 'a/2.jpg']), {
        wrapper,
      });
      await flush();
      expect(mockedSignedUrls).toHaveBeenCalledTimes(1);

      let first = false;
      await act(async () => {
        first = result.current.renew('a/1.jpg');
      });
      await flush();
      expect(first).toBe(true);
      expect(mockedSignedUrls).toHaveBeenCalledTimes(2);

      let again = true;
      await act(async () => {
        again = result.current.renew('a/1.jpg');
      });
      await flush();
      expect(again).toBe(false);
      expect(mockedSignedUrls).toHaveBeenCalledTimes(2);
    });

    it('allows a different path to renew', async () => {
      const { result } = await renderHook(() => useSignedUrls(BUCKET, ['a/1.jpg', 'a/2.jpg']), {
        wrapper,
      });
      await flush();

      await act(async () => {
        result.current.renew('a/1.jpg');
      });
      await flush();
      let other = false;
      await act(async () => {
        other = result.current.renew('a/2.jpg');
      });
      await flush();

      expect(other).toBe(true);
      expect(mockedSignedUrls).toHaveBeenCalledTimes(3);
    });

    it('allows the same path to renew again after a fresh mount', async () => {
      const first = await renderHook(() => useSignedUrls(BUCKET, ['a/1.jpg']), { wrapper });
      await flush();
      await act(async () => {
        first.result.current.renew('a/1.jpg');
      });
      await flush();
      await first.unmount();

      const second = await renderHook(() => useSignedUrls(BUCKET, ['a/1.jpg']), { wrapper });
      await flush();
      let again = false;
      await act(async () => {
        again = second.result.current.renew('a/1.jpg');
      });
      await flush();

      expect(again).toBe(true);
    });

    it('shows no URL after a renewal when the server no longer gives one', async () => {
      const { result } = await renderHook(() => useSignedUrls(BUCKET, ['a/1.jpg']), { wrapper });
      await flush();
      expect(result.current.urlFor('a/1.jpg')).toBe('https://signed/a/1.jpg');

      mockedSignedUrls.mockResolvedValue({ 'a/1.jpg': null });
      await act(async () => {
        result.current.renew('a/1.jpg');
      });
      await flush();

      expect(result.current.urlFor('a/1.jpg')).toBeNull();
    });
  });
});
