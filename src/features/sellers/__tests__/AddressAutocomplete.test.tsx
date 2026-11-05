import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { SellerAppError, autocompletePlaces, resolvePlace } from '../api';
import { AddressAutocomplete } from '../components/AddressAutocomplete';
import { ADDRESS_PRIVACY_NOTE, sellerErrorMessage } from '../messages';
import type { MyBusiness, PlaceSuggestion } from '../schema';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  autocompletePlaces: jest.fn(),
  resolvePlace: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { randomUUID } = require('expo-crypto') as { randomUUID: jest.Mock };
const mockedAutocomplete = autocompletePlaces as unknown as jest.Mock;
const mockedResolve = resolvePlace as unknown as jest.Mock;

const suggestions: PlaceSuggestion[] = [
  { placeId: 'p1', primaryText: '123 Main St', secondaryText: 'Toronto, ON, Canada' },
  { placeId: 'p2', primaryText: '125 Main St', secondaryText: 'Ottawa, ON, Canada' },
];
const SUGGESTION_LABEL = '123 Main St, Toronto, ON, Canada';

const resolved: MyBusiness = {
  id: 'b1',
  type: 'restaurant',
  name: 'Joe',
  cuisine_code: 'IT',
  accepts_table_requests: false,
  map_lat: 43.65,
  map_lng: -79.38,
  public_address: '123 Main St',
  is_listed: true,
  currency_code: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  location: { formatted_address: '123 Main St, Toronto, ON, Canada', lat: 43.65, lng: -79.38 },
};

type Node = { props: Record<string, unknown>; children?: unknown[] };

// The row's height can be set on the touchable or on a wrapper inside it.
function minHeightIn(node: Node): number {
  const style = StyleSheet.flatten(node.props?.style as never) as
    { minHeight?: number; height?: number } | undefined;
  let best = Math.max(style?.minHeight ?? 0, style?.height ?? 0);
  for (const child of node.children ?? []) {
    if (child && typeof child === 'object') best = Math.max(best, minHeightIn(child as Node));
  }
  return best;
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

async function renderAddress(businessType: 'restaurant' | 'homemade' = 'restaurant') {
  const onResolved = jest.fn();
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  await render(
    <QueryClientProvider client={client}>
      <AddressAutocomplete businessType={businessType} onResolved={onResolved} />
    </QueryClientProvider>,
  );
  return onResolved;
}

async function type(text: string) {
  await fireEvent.changeText(screen.getByLabelText('Address'), text);
  await advance(300);
}

const consoleCalls: string[] = [];
const consoleSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  let counter = 0;
  randomUUID.mockImplementation(() => {
    counter += 1;
    return `uuid-${counter}`;
  });
  mockedAutocomplete.mockReset();
  mockedResolve.mockReset();
  mockedAutocomplete.mockResolvedValue(suggestions);
  mockedResolve.mockResolvedValue(resolved);
  consoleCalls.length = 0;
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    consoleSpies.push(
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        consoleCalls.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
      }),
    );
  }
});

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
  consoleSpies.length = 0;
  jest.useRealTimers();
});

describe('AddressAutocomplete', () => {
  it('shows an Address field', async () => {
    await renderAddress();
    expect(screen.getByLabelText('Address')).toBeTruthy();
  });

  it('searches nothing under 3 characters', async () => {
    await renderAddress();
    await type('12');
    expect(mockedAutocomplete).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: SUGGESTION_LABEL })).toBeNull();
  });

  it('shows a loading state while it searches', async () => {
    mockedAutocomplete.mockReturnValue(new Promise(() => {}));
    await renderAddress();
    await type('123 Main');
    expect(mockedAutocomplete).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Searching addresses')).toBeTruthy();
  });

  it('shows suggestions after 3+ characters, each labelled with its full text', async () => {
    await renderAddress();
    await type('123 Main');
    expect(screen.getByRole('button', { name: SUGGESTION_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: '125 Main St, Ottawa, ON, Canada' })).toBeTruthy();
    expect(screen.getByLabelText(SUGGESTION_LABEL)).toBeTruthy();
  });

  it('gives every suggestion row a touch target of at least 44pt', async () => {
    await renderAddress();
    await type('123 Main');
    for (const label of [SUGGESTION_LABEL, '125 Main St, Ottawa, ON, Canada']) {
      const row = screen.getByRole('button', { name: label });
      expect(minHeightIn(row as unknown as Node)).toBeGreaterThanOrEqual(44);
    }
  });

  it('shows the "Powered by Google" attribution with the suggestions', async () => {
    await renderAddress();
    await type('123 Main');
    expect(screen.getByText('Powered by Google')).toBeTruthy();
  });

  it('shows "No matching addresses" when there are no suggestions', async () => {
    mockedAutocomplete.mockResolvedValue([]);
    await renderAddress();
    await type('zzzzzz');
    expect(screen.getByText('No matching addresses')).toBeTruthy();
  });

  it('shows an error with Try again that searches again', async () => {
    mockedAutocomplete.mockRejectedValueOnce(new SellerAppError('network'));
    await renderAddress();
    await type('123 Main');
    expect(screen.getByText(sellerErrorMessage('network'))).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(mockedAutocomplete).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: SUGGESTION_LABEL })).toBeTruthy();
    expect(screen.queryByText(sellerErrorMessage('network'))).toBeNull();
  });

  it('shows the rate-limited message', async () => {
    mockedAutocomplete.mockRejectedValue(new SellerAppError('rate_limited'));
    await renderAddress();
    await type('123 Main');
    expect(screen.getByText(sellerErrorMessage('rate_limited'))).toBeTruthy();
  });

  it('shows the privacy note for a homemade seller', async () => {
    await renderAddress('homemade');
    expect(screen.getByText(ADDRESS_PRIVACY_NOTE)).toBeTruthy();
  });

  it('does not show the privacy note for a restaurant', async () => {
    await renderAddress('restaurant');
    expect(screen.queryByText(ADDRESS_PRIVACY_NOTE)).toBeNull();
  });
});

describe('AddressAutocomplete picking a suggestion', () => {
  it('resolves the place with its ID and the session token, then reports the business', async () => {
    const onResolved = await renderAddress();
    await type('123 Main');
    const searchToken = mockedAutocomplete.mock.calls[0][1];

    await fireEvent.press(screen.getByRole('button', { name: SUGGESTION_LABEL }));
    await settle();

    expect(mockedResolve).toHaveBeenCalledTimes(1);
    expect(mockedResolve.mock.calls[0][0]).toBe('p1');
    expect(mockedResolve.mock.calls[0][1]).toBe(searchToken);
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(onResolved.mock.calls[0][0]).toEqual(resolved);
  });

  it('shows a saving state while the address is being saved', async () => {
    mockedResolve.mockReturnValue(new Promise(() => {}));
    const onResolved = await renderAddress();
    await type('123 Main');
    await fireEvent.press(screen.getByRole('button', { name: SUGGESTION_LABEL }));
    await settle();
    expect(screen.getByLabelText('Saving address')).toBeTruthy();
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('uses a fresh session token for the next search after a place is resolved', async () => {
    await renderAddress();
    await type('123 Main');
    const first = mockedAutocomplete.mock.calls[0][1];
    await fireEvent.press(screen.getByRole('button', { name: SUGGESTION_LABEL }));
    await settle();

    await type('45 Oak Avenue');
    const lastCall = mockedAutocomplete.mock.calls[mockedAutocomplete.mock.calls.length - 1];
    expect(lastCall[0]).toBe('45 Oak Avenue');
    expect(lastCall[1]).not.toBe(first);
  });

  it('shows the not_a_place message and does not report success when saving fails', async () => {
    mockedResolve.mockRejectedValue(new SellerAppError('not_a_place'));
    const onResolved = await renderAddress();
    await type('123 Main');
    await fireEvent.press(screen.getByRole('button', { name: SUGGESTION_LABEL }));
    await settle();
    expect(screen.getByText(sellerErrorMessage('not_a_place'))).toBeTruthy();
    expect(onResolved).not.toHaveBeenCalled();
  });

  // Code review Info 2: the details call ends Google's billed session even when the save fails,
  // so the suggestions are fetched again under a new token, and later searches use it too.
  it('starts a new session token after a failed save and keeps a list to pick from', async () => {
    mockedResolve.mockRejectedValueOnce(new SellerAppError('not_a_place'));
    const onResolved = await renderAddress();
    await type('123 Main');
    expect(mockedAutocomplete).toHaveBeenCalledTimes(1);
    const first = mockedAutocomplete.mock.calls[0][1];
    await fireEvent.press(screen.getByRole('button', { name: SUGGESTION_LABEL }));
    await settle();

    expect(screen.getByText(sellerErrorMessage('not_a_place'))).toBeTruthy();
    expect(onResolved).not.toHaveBeenCalled();
    expect(mockedAutocomplete).toHaveBeenCalledTimes(2);
    const refreshed = mockedAutocomplete.mock.calls[1];
    expect(refreshed[0]).toBe('123 Main');
    expect(refreshed[1]).not.toBe(first);
    expect(screen.getByRole('button', { name: SUGGESTION_LABEL })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: SUGGESTION_LABEL }));
    await settle();
    expect(mockedResolve).toHaveBeenCalledTimes(2);
    expect(mockedResolve.mock.calls[0][1]).toBe(first);
    expect(mockedResolve.mock.calls[1][1]).toBe(refreshed[1]);
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it('shows the rate-limited message when saving is rate limited', async () => {
    mockedResolve.mockRejectedValue(new SellerAppError('rate_limited'));
    const onResolved = await renderAddress();
    await type('123 Main');
    await fireEvent.press(screen.getByRole('button', { name: SUGGESTION_LABEL }));
    await settle();
    expect(screen.getByText(sellerErrorMessage('rate_limited'))).toBeTruthy();
    expect(onResolved).not.toHaveBeenCalled();
  });
});

describe('AddressAutocomplete privacy', () => {
  it('does not log what the seller typed, the place ID or any coordinates', async () => {
    const typed = '221B Baker St';
    mockedAutocomplete.mockResolvedValue([
      { placeId: 'ChIJabc123', primaryText: typed, secondaryText: 'London' },
    ]);
    mockedResolve.mockRejectedValueOnce(new SellerAppError('network'));
    await renderAddress();
    await type(typed);
    await fireEvent.press(screen.getByRole('button', { name: `${typed}, London` }));
    await settle();

    const joined = consoleCalls.join('\n');
    for (const secret of [typed, 'ChIJabc123', '43.6532,-79.3832']) {
      expect(joined).not.toContain(secret);
    }
  });
});
