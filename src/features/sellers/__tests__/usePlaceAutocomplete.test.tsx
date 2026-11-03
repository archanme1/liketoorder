import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { SellerAppError, autocompletePlaces } from '../api';
import { AUTOCOMPLETE_DEBOUNCE_MS, usePlaceAutocomplete } from '../hooks/usePlaceAutocomplete';
import type { PlaceSuggestion } from '../schema';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  autocompletePlaces: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { randomUUID } = require('expo-crypto') as { randomUUID: jest.Mock };
const mockedAutocomplete = autocompletePlaces as unknown as jest.Mock;

const mainSuggestions: PlaceSuggestion[] = [
  { placeId: 'p-main', primaryText: '1 Main St', secondaryText: 'Toronto, ON' },
];

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      jest.advanceTimersByTime(0);
    });
  }
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await settle();
}

async function setup(initialText = '') {
  const client = makeClient();
  const seen: (PlaceSuggestion[] | undefined)[] = [];
  const hook = await renderHook(
    ({ text }: { text: string }) => {
      const value = usePlaceAutocomplete(text);
      seen.push(value.suggestions);
      return value;
    },
    { wrapper: wrapperFor(client), initialProps: { text: initialText } },
  );
  return { client, seen, ...hook };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  let counter = 0;
  randomUUID.mockImplementation(() => {
    counter += 1;
    return `uuid-${counter}`;
  });
  mockedAutocomplete.mockReset();
  mockedAutocomplete.mockResolvedValue(mainSuggestions);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('usePlaceAutocomplete', () => {
  it('exports a 300 ms debounce', () => {
    expect(AUTOCOMPLETE_DEBOUNCE_MS).toBe(300);
  });

  describe('debounce and minimum length', () => {
    it('makes no request before 300 ms and one request after', async () => {
      const { rerender } = await setup();
      await rerender({ text: 'Main Street' });

      await advance(299);
      expect(mockedAutocomplete).not.toHaveBeenCalled();

      await advance(1);
      expect(mockedAutocomplete).toHaveBeenCalledTimes(1);
      expect(mockedAutocomplete.mock.calls[0][0]).toBe('Main Street');
    });

    it('sends one request with the final text after rapid typing', async () => {
      const { rerender } = await setup();
      for (const text of ['Mai', 'Main', 'Main S', 'Main St']) {
        await rerender({ text });
        await advance(100);
      }
      expect(mockedAutocomplete).not.toHaveBeenCalled();

      await advance(AUTOCOMPLETE_DEBOUNCE_MS);
      expect(mockedAutocomplete).toHaveBeenCalledTimes(1);
      expect(mockedAutocomplete.mock.calls[0][0]).toBe('Main St');
    });

    it.each(['', 'a', 'ab'])('makes no request for %p (under 3 characters)', async (text) => {
      const { rerender, result } = await setup();
      await rerender({ text });
      await advance(1000);
      expect(mockedAutocomplete).not.toHaveBeenCalled();
      expect(result.current.searchable).toBe(false);
    });

    it('is searchable from 3 characters', async () => {
      const { rerender, result } = await setup();
      await rerender({ text: 'Mai' });
      expect(result.current.searchable).toBe(true);
    });

    it('drops the request when the text falls back under 3 characters before the debounce ends', async () => {
      const { rerender } = await setup();
      await rerender({ text: 'Main' });
      await advance(100);
      await rerender({ text: 'Ma' });
      await advance(1000);
      expect(mockedAutocomplete).not.toHaveBeenCalled();
    });

    it('reports debouncing while it waits, then not', async () => {
      const { rerender, result } = await setup();
      await rerender({ text: 'Main' });
      expect(result.current.isDebouncing).toBe(true);
      await advance(AUTOCOMPLETE_DEBOUNCE_MS);
      expect(result.current.isDebouncing).toBe(false);
    });

    it('returns the suggestions once the request resolves', async () => {
      const { rerender, result } = await setup();
      await rerender({ text: 'Main' });
      await advance(AUTOCOMPLETE_DEBOUNCE_MS);
      await settle();
      expect(result.current.suggestions).toEqual(mainSuggestions);
    });
  });

  describe('session token', () => {
    it('reuses one token across keystrokes', async () => {
      const { rerender, result } = await setup();
      await rerender({ text: 'Main' });
      await advance(AUTOCOMPLETE_DEBOUNCE_MS);
      await rerender({ text: 'Main St' });
      await advance(AUTOCOMPLETE_DEBOUNCE_MS);
      await rerender({ text: 'Main St W' });
      await advance(AUTOCOMPLETE_DEBOUNCE_MS);

      expect(mockedAutocomplete).toHaveBeenCalledTimes(3);
      const tokens = mockedAutocomplete.mock.calls.map((call) => call[1]);
      expect(new Set(tokens).size).toBe(1);
      expect(tokens[0]).toBe(result.current.sessionToken);
      expect(typeof tokens[0]).toBe('string');
    });

    it('gives a new token after renewSession and uses it for the next request', async () => {
      const { rerender, result } = await setup();
      await rerender({ text: 'Main' });
      await advance(AUTOCOMPLETE_DEBOUNCE_MS);
      const first = result.current.sessionToken;

      await act(async () => {
        result.current.renewSession();
      });
      const second = result.current.sessionToken;
      expect(second).not.toBe(first);

      await rerender({ text: 'Oak Avenue' });
      await advance(AUTOCOMPLETE_DEBOUNCE_MS);

      const lastCall = mockedAutocomplete.mock.calls[mockedAutocomplete.mock.calls.length - 1];
      expect(lastCall[0]).toBe('Oak Avenue');
      expect(lastCall[1]).toBe(second);
      expect(lastCall[1]).not.toBe(first);
    });

    it('takes tokens from expo-crypto randomUUID', async () => {
      const { rerender } = await setup();
      await rerender({ text: 'Main' });
      await advance(AUTOCOMPLETE_DEBOUNCE_MS);
      expect(randomUUID).toHaveBeenCalled();
      expect(mockedAutocomplete.mock.calls[0][1]).toMatch(/^uuid-\d+$/);
    });
  });

  describe('stale results', () => {
    it('never returns the first result when it resolves after the second request', async () => {
      const slow: { resolve: (value: PlaceSuggestion[]) => void } = { resolve: () => {} };
      const first: PlaceSuggestion[] = [
        { placeId: 'p-first', primaryText: 'First', secondaryText: 'Old' },
      ];
      const second: PlaceSuggestion[] = [
        { placeId: 'p-second', primaryText: 'Second', secondaryText: 'New' },
      ];
      mockedAutocomplete.mockImplementation((input: string) =>
        input === 'Main'
          ? new Promise<PlaceSuggestion[]>((resolve) => {
              slow.resolve = resolve;
            })
          : Promise.resolve(second),
      );

      const { rerender, result, seen } = await setup();
      await rerender({ text: 'Main' });
      await advance(AUTOCOMPLETE_DEBOUNCE_MS);
      expect(mockedAutocomplete).toHaveBeenCalledTimes(1);

      await rerender({ text: 'Main St' });
      await advance(AUTOCOMPLETE_DEBOUNCE_MS);
      expect(mockedAutocomplete).toHaveBeenCalledTimes(2);
      expect(result.current.suggestions).toEqual(second);

      await act(async () => {
        slow.resolve(first);
      });
      await settle();

      expect(result.current.suggestions).toEqual(second);
      const everSawFirst = seen.some((s) => (s ?? []).some((item) => item.placeId === 'p-first'));
      expect(everSawFirst).toBe(false);
    });
  });

  describe('errors', () => {
    it('exposes a SellerAppError and retry runs the request again', async () => {
      mockedAutocomplete.mockRejectedValueOnce(new SellerAppError('rate_limited'));
      const { rerender, result } = await setup();
      await rerender({ text: 'Main' });
      await advance(AUTOCOMPLETE_DEBOUNCE_MS);
      await settle();

      expect(result.current.error).toBeInstanceOf(SellerAppError);
      expect(result.current.error?.code).toBe('rate_limited');

      await act(async () => {
        result.current.retry();
      });
      await settle();

      expect(mockedAutocomplete).toHaveBeenCalledTimes(2);
      expect(result.current.error).toBeFalsy();
      expect(result.current.suggestions).toEqual(mainSuggestions);
    });
  });
});
