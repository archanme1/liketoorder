import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { listCuisines } from '@/features/cuisines/api';
import { resetModuleMocks, testClientOptions } from '@/features/food-log/__fixtures__/foodLog';
import { signedUrls } from '@/features/media/api';
import { supabase } from '@/lib/supabase';

import { createOffersServer, manyOffers, type OffersServer } from '../__fixtures__/offers';
import { offersScreenTree, RAW_POSITION, setLocation, VIETNAM } from '../__fixtures__/offersScreen';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
jest.mock('@/features/cuisines/api', () => ({
  ...jest.requireActual('@/features/cuisines/api'),
  listCuisines: jest.fn(),
}));
jest.mock('@/features/media/api', () => ({
  ...jest.requireActual('@/features/media/api'),
  signedUrls: jest.fn(),
}));

// Spec 16 Decision D2: the exact position never leaves the phone. The screen is driven through
// every path that sends a request, and every argument the api spy sees is checked: always the
// snapped grid point, always a POST (exactly two arguments), never the raw digits; and nothing
// about the position is stored or logged.

const rpc = jest.mocked(supabase.rpc) as unknown as jest.Mock;
// One long walk through every path: generous waits, so a busy machine never times it out.
const SLOW = { timeout: 4000 };
let client: QueryClient;
let server: OffersServer;

// 43.8971, -78.8658: these digit runs appear nowhere in the grid point (43.9, -78.85).
const RAW_DIGITS = /8971|8658/;
const onGrid = (v: unknown) =>
  typeof v === 'number' && Math.abs(v * 20 - Math.round(v * 20)) <= 1e-9;

function expectOnlySnappedCalls() {
  expect(rpc.mock.calls.length).toBeGreaterThan(0);
  for (const call of rpc.mock.calls) {
    // POST: supabase.rpc(name, params) with no options object such as { get: true }.
    expect(call).toHaveLength(2);
    const [name, args] = call as [string, Record<string, unknown>];
    expect(name).toBe('list_offers_near');
    expect(onGrid(args.p_lat)).toBe(true);
    expect(onGrid(args.p_lng)).toBe(true);
    expect(args.p_lat).not.toBe(RAW_POSITION.latitude);
    expect(args.p_lng).not.toBe(RAW_POSITION.longitude);
    expect(JSON.stringify(args)).not.toMatch(RAW_DIGITS);
  }
}

beforeEach(async () => {
  await AsyncStorage.clear();
  client = new QueryClient(testClientOptions());
  server = createOffersServer({ rows: manyOffers(25) });
  rpc.mockImplementation((name: string, args?: Record<string, unknown>) => server.rpc(name, args));
  jest.mocked(listCuisines).mockResolvedValue([VIETNAM]);
  jest.mocked(signedUrls).mockResolvedValue({});
  setLocation('granted');
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
  resetModuleMocks('@/lib/supabase', '@/features/cuisines/api', '@/features/media/api');
});

it('sends only the snapped point, by POST, through every path, and never stores or logs the position', async () => {
  const setItem = jest.spyOn(AsyncStorage, 'setItem');
  // The storage mock already counted the test's own setup writes.
  setItem.mockClear();
  const logs = [
    jest.spyOn(console, 'log').mockImplementation(() => {}),
    jest.spyOn(console, 'warn').mockImplementation(() => {}),
    jest.spyOn(console, 'error').mockImplementation(() => {}),
    jest.spyOn(console, 'info').mockImplementation(() => {}),
    jest.spyOn(console, 'debug').mockImplementation(() => {}),
  ];

  await render(offersScreenTree(client));
  await screen.findByText('Near you', {}, SLOW);
  await waitFor(() => expect(server.calls).toHaveLength(1), SLOW);

  // Page 2.
  await act(async () => fireEvent(screen.getByTestId('offers-list'), 'endReached'));
  await waitFor(() => expect(server.calls).toHaveLength(2), SLOW);
  // A filter.
  await fireEvent.press(screen.getByTestId('filters-button'));
  const filters = within(await screen.findByTestId('filters-panel', {}, SLOW));
  await fireEvent.press(filters.getByRole('radio', { name: 'About 30 km' }));
  await fireEvent.press(filters.getByRole('button', { name: 'Show offers' }));
  await waitFor(() => expect(server.calls).toHaveLength(3), SLOW);
  // Pull to refresh (a new position is read first).
  await act(async () => {
    await screen.getByTestId('offers-list').props.refreshControl.props.onRefresh();
  });
  await waitFor(() => expect(server.calls).toHaveLength(4), SLOW);
  // Change area to the launch area, then back to my location.
  await fireEvent.press(screen.getByRole('button', { name: 'Change area' }));
  let sheet = within(await screen.findByTestId('change-area', {}, SLOW));
  await fireEvent.press(sheet.getByRole('radio', { name: 'Oshawa (launch area)' }));
  await screen.findByText('Near Oshawa', {}, SLOW);
  await fireEvent.press(screen.getByRole('button', { name: 'Change area' }));
  sheet = within(await screen.findByTestId('change-area', {}, SLOW));
  await fireEvent.press(sheet.getByRole('radio', { name: 'Use my location' }));
  await screen.findByText('Near you', {}, SLOW);
  await act(async () => {});

  expectOnlySnappedCalls();
  for (const call of setItem.mock.calls) expect(JSON.stringify(call)).not.toMatch(RAW_DIGITS);
  for (const spy of logs) {
    for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toMatch(RAW_DIGITS);
  }
  // Nothing in the query cache carries the raw position either.
  const keys = client
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey);
  expect(JSON.stringify(keys)).not.toMatch(RAW_DIGITS);
}, 20_000);
