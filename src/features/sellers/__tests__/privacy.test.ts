import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

import {
  SellerAppError,
  autocompletePlaces,
  mapFunctionError,
  mapSellerError,
  resolvePlace,
} from '../api';
import { usePlaceAutocomplete } from '../hooks/usePlaceAutocomplete';

// Spec 05: "Do not log address input, place IDs or coordinates in the app", and the error type
// carries only a code. Private text must not survive into error output, logs or the query cache.

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-privacy') }));
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));

const mocked = supabase as unknown as {
  rpc: jest.Mock;
  functions: { invoke: jest.Mock };
};

const ADDRESS = '221B Baker St';
const PLACE_ID = 'ChIJabc123';
const COORDS = '43.6532,-79.3832';
const SECRETS = [ADDRESS, PLACE_ID, COORDS, '43.6532', '-79.3832', 'Baker'];
const LEAKY = `${ADDRESS} ${PLACE_ID} ${COORDS}`;

function leaksIn(text: string | undefined): string[] {
  const haystack = (text ?? '').toLowerCase();
  return SECRETS.filter((secret) => haystack.includes(secret.toLowerCase()));
}

// Every string a caller could end up printing or sending for an error, except the stack trace.
function outputsOf(error: unknown): string[] {
  const e = error as Record<string, unknown>;
  const ownFields = Object.fromEntries(
    Object.getOwnPropertyNames(error)
      .filter((key) => key !== 'stack')
      .map((key) => [key, e[key]]),
  );
  return [
    (error as Error).message,
    String(error),
    JSON.stringify(error),
    JSON.stringify(ownFields),
    `${(error as Error).name}: ${(error as Error).message}`,
  ];
}

function expectNoLeak(error: unknown) {
  expect(error).toBeInstanceOf(SellerAppError);
  for (const output of outputsOf(error)) {
    expect(leaksIn(output)).toEqual([]);
  }
}

function httpError(status: number, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new FunctionsHttpError(new Response(text, { status }));
}

const consoleCalls: string[] = [];
const consoleSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  consoleCalls.length = 0;
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    consoleSpies.push(
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        consoleCalls.push(
          args
            .map((arg) => {
              if (typeof arg === 'string') return arg;
              try {
                return JSON.stringify(arg);
              } catch {
                return String(arg);
              }
            })
            .join(' '),
        );
      }),
    );
  }
});

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
  consoleSpies.length = 0;
});

describe('mapSellerError keeps private text out of the error', () => {
  const cases: [string, unknown][] = [
    ['raised code with private details', { code: 'P0001', message: 'no_business', details: LEAKY }],
    ['unknown raised message', { code: 'P0001', message: `bad ${LEAKY}`, details: LEAKY }],
    [
      'check constraint failing row',
      {
        code: '23514',
        message: 'new row violates check constraint',
        details: `Failing row contains (${ADDRESS}, ${PLACE_ID}, ${COORDS}).`,
        hint: LEAKY,
      },
    ],
    ['cuisine foreign key', { code: '23503', message: LEAKY, details: LEAKY }],
    ['codeless network message', { message: `Failed to fetch ${LEAKY}`, details: LEAKY }],
    ['permission error', { code: '42501', message: LEAKY, details: null }],
    ['plain Error', new Error(LEAKY)],
    ['a string', LEAKY],
    ['FunctionsFetchError', new FunctionsFetchError(new TypeError(LEAKY))],
    ['FunctionsRelayError', new FunctionsRelayError({ message: LEAKY, placeId: PLACE_ID })],
  ];

  it.each(cases)('%s', (_label, input) => {
    expectNoLeak(mapSellerError(input));
  });
});

describe('mapFunctionError keeps private text out of the error', () => {
  const body = {
    error: {
      code: 'invalid_input',
      message: `No such address ${ADDRESS}`,
      placeId: PLACE_ID,
      location: COORDS,
    },
  };

  it.each([400, 403, 404, 422, 429, 502])(
    'status %s with private fields in the body',
    async (status) => {
      expectNoLeak(await mapFunctionError(httpError(status, body)));
    },
  );

  it('an unknown code with private fields', async () => {
    expectNoLeak(
      await mapFunctionError(httpError(500, { error: { code: 'weird', message: LEAKY } })),
    );
  });

  it('an unreadable 429 body that contains private text', async () => {
    expectNoLeak(await mapFunctionError(httpError(429, `<html>${LEAKY}</html>`)));
  });

  it('an unreadable 500 body that contains private text', async () => {
    expectNoLeak(await mapFunctionError(httpError(500, LEAKY)));
  });

  it('a non-Response context that contains private text', async () => {
    expectNoLeak(await mapFunctionError(new FunctionsHttpError({ message: LEAKY, status: 500 })));
  });

  it('a fetch failure that contains private text', async () => {
    expectNoLeak(await mapFunctionError(new FunctionsFetchError(new TypeError(LEAKY))));
  });

  it('a plain error that contains private text', async () => {
    expectNoLeak(await mapFunctionError(new Error(LEAKY)));
  });
});

describe('api calls that fail do not leak or log', () => {
  it('autocompletePlaces with a failing function', async () => {
    mocked.functions.invoke.mockResolvedValue({
      data: null,
      error: httpError(502, { error: { code: 'upstream_error', message: LEAKY } }),
    });
    let thrown: unknown;
    try {
      await autocompletePlaces(ADDRESS, 'token');
    } catch (e) {
      thrown = e;
    }
    expectNoLeak(thrown);
    expect(consoleCalls.filter((call) => leaksIn(call).length > 0)).toEqual([]);
  });

  it('resolvePlace with a failing function', async () => {
    mocked.functions.invoke.mockResolvedValue({
      data: null,
      error: httpError(422, { error: { code: 'not_a_place', message: LEAKY } }),
    });
    let thrown: unknown;
    try {
      await resolvePlace(PLACE_ID, 'token');
    } catch (e) {
      thrown = e;
    }
    expectNoLeak(thrown);
    expect(consoleCalls.filter((call) => leaksIn(call).length > 0)).toEqual([]);
  });

  it('resolvePlace with a malformed owner view that contains private text', async () => {
    mocked.functions.invoke.mockResolvedValue({
      data: { formatted_address: ADDRESS, lat: 43.6532, lng: -79.3832, placeId: PLACE_ID },
      error: null,
    });
    let thrown: unknown;
    try {
      await resolvePlace(PLACE_ID, 'token');
    } catch (e) {
      thrown = e;
    }
    expectNoLeak(thrown);
    expect(consoleCalls.filter((call) => leaksIn(call).length > 0)).toEqual([]);
  });
});

describe('the suggestion cache and logs while typing an address', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function settle() {
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        jest.advanceTimersByTime(0);
      });
    }
  }

  function setup() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    return { client, wrapper };
  }

  it('never puts the typed text in any query key', async () => {
    mocked.functions.invoke.mockResolvedValue({
      data: {
        suggestions: [{ placeId: PLACE_ID, primaryText: ADDRESS, secondaryText: 'London' }],
      },
      error: null,
    });
    const { client, wrapper } = setup();
    const { rerender } = await renderHook(
      ({ text }: { text: string }) => usePlaceAutocomplete(text),
      { wrapper, initialProps: { text: '' } },
    );

    for (const text of ['221', '221B', '221B Baker', ADDRESS]) {
      await rerender({ text });
      await act(async () => {
        jest.advanceTimersByTime(400);
      });
      await settle();
    }

    expect(mocked.functions.invoke).toHaveBeenCalled();
    const keys = client
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const serialised = JSON.stringify(key);
      expect(serialised).not.toContain(ADDRESS);
      for (const typed of ['221B', 'Baker']) {
        expect(serialised.toLowerCase()).not.toContain(typed.toLowerCase());
      }
    }
  });

  it('keeps suggestion queries under the places/autocomplete key prefix', async () => {
    mocked.functions.invoke.mockResolvedValue({ data: { suggestions: [] }, error: null });
    const { client, wrapper } = setup();
    const { rerender } = await renderHook(
      ({ text }: { text: string }) => usePlaceAutocomplete(text),
      { wrapper, initialProps: { text: '' } },
    );
    await rerender({ text: ADDRESS });
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    await settle();

    const keys = client
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey);
    expect(keys.some((key) => key[0] === 'places' && key[1] === 'autocomplete')).toBe(true);
  });

  it('does not log the typed address, place IDs or coordinates, even when the search fails', async () => {
    mocked.functions.invoke.mockResolvedValue({
      data: null,
      error: httpError(502, { error: { code: 'upstream_error', message: LEAKY } }),
    });
    const { wrapper } = setup();
    const { rerender } = await renderHook(
      ({ text }: { text: string }) => usePlaceAutocomplete(text),
      { wrapper, initialProps: { text: '' } },
    );
    await rerender({ text: ADDRESS });
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    await settle();

    expect(mocked.functions.invoke).toHaveBeenCalled();
    expect(consoleCalls.filter((call) => leaksIn(call).length > 0)).toEqual([]);
  });
});
