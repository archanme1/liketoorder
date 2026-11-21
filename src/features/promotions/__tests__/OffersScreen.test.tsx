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
import { AccessibilityInfo } from 'react-native';

import { listCuisines } from '@/features/cuisines/api';
import { resetModuleMocks, testClientOptions } from '@/features/food-log/__fixtures__/foodLog';
import { signedUrls } from '@/features/media/api';
import { supabase } from '@/lib/supabase';

import {
  COVER_JSON,
  createOffersServer,
  makeOffer,
  manyOffers,
  offerId,
  type OffersServer,
} from '../__fixtures__/offers';
import { offersScreenTree, setLocation, VIETNAM } from '../__fixtures__/offersScreen';
import { NETWORK_ERROR, pgError } from '../__fixtures__/promotion';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
jest.mock('@/features/cuisines/api', () => ({
  ...jest.requireActual('@/features/cuisines/api'),
  listCuisines: jest.fn(),
}));
jest.mock('@/features/media/api', () => ({
  ...jest.requireActual('@/features/media/api'),
  signedUrls: jest.fn(),
}));

const rpc = jest.mocked(supabase.rpc) as unknown as jest.Mock;
let client: QueryClient;
let server: OffersServer;

const cards = () => screen.queryAllByRole('button', { name: /, sponsored$/ });
const list = () => screen.getByTestId('offers-list');
const endReached = () => act(async () => fireEvent(list(), 'endReached'));
const lastCall = () => server.calls[server.calls.length - 1];

async function renderScreen(props: Parameters<typeof offersScreenTree>[1] = {}) {
  return render(offersScreenTree(client, props));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  client = new QueryClient(testClientOptions());
  server = createOffersServer({ rows: [makeOffer()] });
  rpc.mockImplementation((name: string, args?: Record<string, unknown>) => server.rpc(name, args));
  jest.mocked(listCuisines).mockResolvedValue([VIETNAM]);
  jest.mocked(signedUrls).mockResolvedValue({ [COVER_JSON.path]: 'https://example.test/c.jpg' });
  setLocation('granted');
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
  resetModuleMocks('@/lib/supabase', '@/features/cuisines/api', '@/features/media/api');
});

describe('Offers screen states', () => {
  it('shows skeleton cards with one "Loading offers" while the first page loads', async () => {
    let answer: (value: { data: unknown; error: unknown }) => void = () => {};
    rpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await renderScreen();
    expect(await screen.findByLabelText('Loading offers')).toBeOnTheScreen();
    expect(cards()).toHaveLength(0);
    await act(async () =>
      answer({ data: { offers: [makeOffer()], next_cursor: null }, error: null }),
    );
    expect(await screen.findByRole('button', { name: /^Simcoe Street Pho/ })).toBeOnTheScreen();
    expect(screen.queryByLabelText('Loading offers')).toBeNull();
  });

  it('shows the cards, each with "Sponsored", and the end of the list', async () => {
    server.rows = [
      makeOffer(),
      makeOffer({
        business_id: offerId(2),
        name: 'Amara Jollof',
        type: 'homemade',
        cover: COVER_JSON,
      }),
    ];
    await renderScreen();
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(screen.getAllByTestId('sponsored-label', { includeHiddenElements: true })).toHaveLength(
      2,
    );
    expect(screen.getByText("That's all the offers near here.")).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Offers' })).toBeOnTheScreen();
    expect(screen.getByText('Near you')).toBeOnTheScreen();
  });

  it('shows the error with its plain words, and Try again loads the list', async () => {
    server.failNext = pgError('rate_limited');
    await renderScreen();
    expect(
      await screen.findByText("You're looking around very quickly. Wait a minute, then try again."),
    ).toBeOnTheScreen();
    expect(cards()).toHaveLength(0);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(cards()).toHaveLength(1));
  });

  it('says the connection is down after one quiet retry', async () => {
    server.failAlways = NETWORK_ERROR;
    await renderScreen();
    expect(
      await screen.findByText(
        "Can't reach LikeToOrder. Check your connection and try again.",
        {},
        { timeout: 4000 },
      ),
    ).toBeOnTheScreen();
    expect(server.calls).toHaveLength(2);
  });

  it('shows the empty message, and Browse the map opens the map', async () => {
    server.rows = [];
    const onBrowseMap = jest.fn();
    await renderScreen({ onBrowseMap });
    expect(
      await screen.findByText('No offers near you right now. Check back later or browse the map.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Browse the map' }));
    expect(onBrowseMap).toHaveBeenCalledTimes(1);
  });

  it('opens a card on its map', async () => {
    const onOpenOffer = jest.fn();
    await renderScreen({ onOpenOffer });
    await fireEvent.press(await screen.findByRole('button', { name: /^Simcoe Street Pho/ }));
    expect(onOpenOffer).toHaveBeenCalledWith(
      expect.objectContaining({ business_id: makeOffer().business_id }),
    );
  });
});

describe('paging', () => {
  beforeEach(() => {
    server.rows = manyOffers(45);
  });

  // The list draws 20 cards at first and more as it is scrolled (virtualized), so paging is checked
  // through the requests and the footer; the hook test proves each offer comes once.
  it('loads 20, then the next page with a spinner, then the last page and the end', async () => {
    let hold: (() => void) | null = null;
    await renderScreen();
    await waitFor(() => expect(cards()).toHaveLength(20));
    expect(screen.queryByText("That's all the offers near here.")).toBeNull();

    // Hold page 2 to see the footer spinner.
    const real = server.rpc;
    rpc.mockImplementationOnce(
      (name: string, args?: Record<string, unknown>) =>
        new Promise((resolve) => {
          hold = () => resolve(real(name, args));
        }),
    );
    await endReached();
    expect(await screen.findByLabelText('Loading more offers')).toBeOnTheScreen();
    // A second end-reached while page 2 is loading asks for nothing more.
    await endReached();
    expect(rpc).toHaveBeenCalledTimes(2);
    await act(async () => hold?.());
    await waitFor(() => expect(screen.queryByLabelText('Loading more offers')).toBeNull());
    expect(server.calls).toHaveLength(2);
    expect(screen.queryByText("That's all the offers near here.")).toBeNull();

    await endReached();
    expect(await screen.findByText("That's all the offers near here.")).toBeOnTheScreen();
    expect(server.calls.map((call) => call.p_cursor === null)).toEqual([true, false, false]);
    // Each next page sends the cursor the page before it answered.
    expect(server.calls[1].p_cursor).toMatch(/^2026-11-20\|0\|[0-9a-f]{32}\|/);
    await endReached();
    expect(server.calls).toHaveLength(3);
  });

  it('shows "Couldn\'t load more" with Try again when a next page fails', async () => {
    await renderScreen();
    await waitFor(() => expect(cards()).toHaveLength(20));
    server.failNext = pgError('rate_limited');
    await endReached();
    expect(await screen.findByText("Couldn't load more offers.")).toBeOnTheScreen();
    expect(cards()).toHaveLength(20);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText("Couldn't load more offers.")).toBeNull());
    expect(server.calls.map((call) => call.p_cursor === null)).toEqual([true, false, false]);
  });

  it('pull to refresh goes back to page 1', async () => {
    await renderScreen();
    await waitFor(() => expect(cards()).toHaveLength(20));
    await endReached();
    await waitFor(() => expect(server.calls).toHaveLength(2));
    server.rows = manyOffers(3);
    await act(async () => {
      await list().props.refreshControl.props.onRefresh();
    });
    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(lastCall().p_cursor).toBeNull();
    expect(screen.getByText("That's all the offers near here.")).toBeOnTheScreen();
  });

  it('keeps the list and says so when a pull to refresh fails', async () => {
    await renderScreen();
    await waitFor(() => expect(cards()).toHaveLength(20));
    server.failAlways = NETWORK_ERROR;
    await act(async () => {
      await list().props.refreshControl.props.onRefresh();
    });
    expect(await screen.findByText("Couldn't refresh. Pull to try again.")).toBeOnTheScreen();
    expect(cards()).toHaveLength(20);
  });
});

describe('filters', () => {
  it('starts on All, All, About 15 km and Any', async () => {
    await renderScreen();
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(lastCall()).toMatchObject({
      p_distance_km: 15,
      p_category: null,
      p_type: null,
      p_tables: false,
    });
    for (const name of ['All, selected', 'About 15 km, selected', 'Any, selected']) {
      expect(screen.getAllByRole('radio', { name }).length).toBeGreaterThan(0);
    }
  });

  it.each([
    ['Featured', { p_category: 'featured' }],
    ['New on the menu', { p_category: 'new_dish' }],
    ['Special offer', { p_category: 'special_offer' }],
    ['Restaurants', { p_type: 'restaurant' }],
    ['Home cooks', { p_type: 'homemade' }],
    ['About 5 km', { p_distance_km: 5 }],
    ['About 30 km', { p_distance_km: 30 }],
    ['Takes table requests', { p_tables: true }],
  ])('"%s" asks for a new list with the right argument', async (chip, args) => {
    await renderScreen();
    await waitFor(() => expect(cards()).toHaveLength(1));
    await fireEvent.press(screen.getByRole('radio', { name: chip }));
    await waitFor(() => expect(lastCall()).toMatchObject({ ...args, p_cursor: null }));
    expect(screen.getByRole('radio', { name: `${chip}, selected` })).toBeOnTheScreen();
  });

  it('announces how many offers the new list has', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    server.rows = manyOffers(3, { category: 'featured' });
    await renderScreen();
    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(announce).not.toHaveBeenCalled();
    server.rows = [];
    await fireEvent.press(screen.getByRole('radio', { name: 'New on the menu' }));
    await waitFor(() => expect(announce).toHaveBeenCalledWith('No offers'));
    server.rows = manyOffers(3, { category: 'featured' });
    await fireEvent.press(screen.getByRole('radio', { name: 'Featured' }));
    await waitFor(() => expect(announce).toHaveBeenCalledWith('3 offers'));
  });
});

describe('focus', () => {
  it('reloads a stale list when the tab comes back into view, and not a fresh one', async () => {
    const view = await renderScreen({ focused: true });
    await waitFor(() => expect(cards()).toHaveLength(1));
    await view.rerender(offersScreenTree(client, { focused: false }));
    await view.rerender(offersScreenTree(client, { focused: true }));
    await act(async () => {});
    expect(server.calls).toHaveLength(1);

    await act(async () => {
      await client.invalidateQueries({ queryKey: ['offers'], refetchType: 'none' });
    });
    await view.rerender(offersScreenTree(client, { focused: false }));
    await view.rerender(offersScreenTree(client, { focused: true }));
    await waitFor(() => expect(server.calls).toHaveLength(2));
  });
});

describe('the card', () => {
  it('reads its parts in order and ends with sponsored', async () => {
    await renderScreen();
    const card = await screen.findByRole('button', { name: /^Simcoe Street Pho/ });
    expect(card.props.accessibilityLabel).toBe(
      'Simcoe Street Pho, Vietnam cuisine, restaurant. Special offer: Two bowls of pho for the price of one. Less than 1 km away, sponsored',
    );
    expect(within(card).getByText('Sponsored', { includeHiddenElements: true })).toBeTruthy();
  });
});
