import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { listCuisines } from '@/features/cuisines/api';
import { signedUrls } from '@/features/media/api';

import { CUISINES, foodLog, resetModuleMocks, testClientOptions } from '../__fixtures__/foodLog';
import { claimFoodLogCleanup, FoodLogAppError, listMyFoodLogs } from '../api';
import { FoodLogListScreen } from '../components/FoodLogListScreen';
import { FOOD_LOG_EMPTY, LOAD_MORE_ERROR } from '../messages';
import type { FoodLogPage } from '../schema';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listMyFoodLogs: jest.fn(),
  claimFoodLogCleanup: jest.fn(),
}));
jest.mock('@/features/media/api', () => ({
  signedUrls: jest.fn(),
  uploadToBucket: jest.fn(),
  removeFromBucket: jest.fn(),
}));
jest.mock('@/features/cuisines/api', () => ({
  ...jest.requireActual('@/features/cuisines/api'),
  listCuisines: jest.fn(),
}));

const mockedList = jest.mocked(listMyFoodLogs);
const mockedClaim = jest.mocked(claimFoodLogCleanup);
const mockedSigned = jest.mocked(signedUrls);
const mockedCuisines = jest.mocked(listCuisines);

let client: QueryClient;

/** A page that arrives when the test says so. */
function heldPage() {
  let resolve: (page: FoodLogPage) => void = () => {};
  const promise = new Promise<FoodLogPage>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const list = () => screen.getByTestId('food-log-list');
const NETWORK = /Can't reach LikeToOrder/;

/** Pull to refresh, as the RefreshControl would. */
async function pullToRefresh() {
  const control = list().props.refreshControl as { props: { onRefresh: () => void } };
  await act(async () => control.props.onRefresh());
}

async function renderScreen() {
  client = new QueryClient(testClientOptions());
  // The app loads the cuisine list once per launch; seeded so labels don't wait on it.
  client.setQueryDefaults(['cuisines'], { gcTime: Infinity });
  client.setQueryData(['cuisines'], CUISINES);
  return render(
    <QueryClientProvider client={client}>
      <FoodLogListScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedClaim.mockResolvedValue([]);
  mockedCuisines.mockResolvedValue(CUISINES);
  mockedSigned.mockImplementation(async (_bucket, paths) =>
    Object.fromEntries(paths.map((p) => [p, `https://signed.example/${p}`])),
  );
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
  resetModuleMocks('../api', '@/features/media/api', '@/features/cuisines/api');
});

describe('FoodLogListScreen states', () => {
  it('shows a loading state', async () => {
    mockedList.mockReturnValue(new Promise(() => {}));
    await renderScreen();
    expect(screen.getByLabelText('Loading food photos')).toBeOnTheScreen();
  });

  it('shows the empty state with Add photo still there', async () => {
    mockedList.mockResolvedValue({ items: [], next_cursor: null });
    await renderScreen();
    expect(await screen.findByText(FOOD_LOG_EMPTY)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Add photo' })).toBeOnTheScreen();
  });

  it('shows an error with Try again, which loads the list', async () => {
    mockedList.mockRejectedValueOnce(new FoodLogAppError('network'));
    mockedList.mockResolvedValueOnce({ items: [foodLog(1)], next_cursor: null });
    await renderScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('button', {
        name: /^Food photo, Italy, Sat, Nov 14, 2026\. Meal 1\./,
      }),
    ).toBeOnTheScreen();
  });

  it('shows rows with spoken labels, Private as a word, and signs only my own paths', async () => {
    mockedList.mockResolvedValue({
      items: [foodLog(1), foodLog(2, { is_public: false, description: null, cuisine_code: 'JP' })],
      next_cursor: null,
    });
    await renderScreen();
    expect(
      await screen.findByRole('button', { name: 'Food photo, Italy, Sat, Nov 14, 2026. Meal 1.' }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', {
        name: 'Food photo, Japan, Sat, Nov 14, 2026. No description. Private',
      }),
    ).toBeOnTheScreen();
    expect(screen.getAllByText('Private', { includeHiddenElements: true })).toHaveLength(1);
    await waitFor(() => expect(mockedSigned).toHaveBeenCalled());
    expect(mockedSigned.mock.calls[0][0]).toBe('food-logs');
    expect([...mockedSigned.mock.calls[0][1]].sort()).toEqual(
      [foodLog(1).path, foodLog(2).path].sort(),
    );
  });

  it('runs the storage cleanup when it opens', async () => {
    mockedList.mockResolvedValue({ items: [], next_cursor: null });
    await renderScreen();
    await waitFor(() => expect(mockedClaim).toHaveBeenCalled());
  });
});

describe('FoodLogListScreen paging and navigation', () => {
  it('loads the next page from next_cursor near the end', async () => {
    mockedList
      .mockResolvedValueOnce({ items: [foodLog(1), foodLog(2)], next_cursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [foodLog(3)], next_cursor: null });
    await renderScreen();
    await screen.findByRole('button', { name: /Meal 2\./ });
    await fireEvent(screen.getByTestId('food-log-list'), 'onEndReached');
    expect(await screen.findByRole('button', { name: /Meal 3\./ })).toBeOnTheScreen();
    expect(mockedList).toHaveBeenLastCalledWith('cursor-1');
  });

  it('Add photo opens the form and a row opens its photo', async () => {
    mockedList.mockResolvedValue({ items: [foodLog(1)], next_cursor: null });
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Add photo' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/food-log/new');
    await fireEvent.press(await screen.findByRole('button', { name: /Meal 1\./ }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/food-log/[id]',
      params: { id: foodLog(1).id },
    });
  });
});

describe('FoodLogListScreen loading more and refreshing', () => {
  it('shows a footer spinner while the next page loads and never loads it twice', async () => {
    const page2 = heldPage();
    mockedList
      .mockResolvedValueOnce({ items: [foodLog(1)], next_cursor: 'cursor-1' })
      .mockReturnValueOnce(page2.promise);
    await renderScreen();
    await screen.findByRole('button', { name: /Meal 1\./ });
    await fireEvent(list(), 'onEndReached');
    expect(await screen.findByLabelText('Loading more food photos')).toBeOnTheScreen();
    await fireEvent(list(), 'onEndReached');
    expect(mockedList).toHaveBeenCalledTimes(2);

    page2.resolve({ items: [foodLog(2)], next_cursor: null });
    expect(await screen.findByRole('button', { name: /Meal 2\./ })).toBeOnTheScreen();
    expect(screen.queryByLabelText('Loading more food photos')).toBeNull();
  });

  it('a failed next page keeps the rows, offers Try again and does not retry by itself', async () => {
    mockedList
      .mockResolvedValueOnce({ items: [foodLog(1)], next_cursor: 'cursor-1' })
      .mockRejectedValueOnce(new FoodLogAppError('network'))
      .mockResolvedValueOnce({ items: [foodLog(2)], next_cursor: null });
    await renderScreen();
    await screen.findByRole('button', { name: /Meal 1\./ });
    await fireEvent(list(), 'onEndReached');
    expect(await screen.findByText(LOAD_MORE_ERROR)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /Meal 1\./ })).toBeOnTheScreen();

    // Reaching the end again doesn't loop on the failed page.
    await fireEvent(list(), 'onEndReached');
    expect(mockedList).toHaveBeenCalledTimes(2);

    await fireEvent.press(
      screen.getByRole('button', { name: 'Try loading more food photos again' }),
    );
    expect(await screen.findByRole('button', { name: /Meal 2\./ })).toBeOnTheScreen();
    expect(mockedList).toHaveBeenLastCalledWith('cursor-1');
    expect(screen.queryByText(LOAD_MORE_ERROR)).toBeNull();
  });

  it('pull to refresh starts again from the newest page', async () => {
    mockedList
      .mockResolvedValueOnce({ items: [foodLog(1)], next_cursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [foodLog(2)], next_cursor: null })
      .mockResolvedValueOnce({ items: [foodLog(9), foodLog(1)], next_cursor: 'cursor-2' });
    await renderScreen();
    await screen.findByRole('button', { name: /Meal 1\./ });
    await fireEvent(list(), 'onEndReached');
    await screen.findByRole('button', { name: /Meal 2\./ });

    await pullToRefresh();
    expect(await screen.findByRole('button', { name: /Meal 9\./ })).toBeOnTheScreen();
    expect(mockedList).toHaveBeenCalledTimes(3);
    expect(mockedList).toHaveBeenLastCalledWith(null);
    // The older page is dropped; it loads again only when the end is reached.
    expect(screen.queryByRole('button', { name: /Meal 2\./ })).toBeNull();
    expect(list().props.refreshControl.props.refreshing).toBe(false);
  });

  it('a failed refresh keeps the rows and shows a banner with Try again', async () => {
    mockedList
      .mockResolvedValueOnce({ items: [foodLog(1)], next_cursor: null })
      .mockRejectedValueOnce(new FoodLogAppError('network'))
      .mockResolvedValueOnce({ items: [foodLog(1)], next_cursor: null });
    await renderScreen();
    await screen.findByRole('button', { name: /Meal 1\./ });

    await pullToRefresh();
    expect(await screen.findByText(NETWORK)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /Meal 1\./ })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Try refreshing again' }));
    await waitFor(() => expect(screen.queryByText(NETWORK)).toBeNull());
    expect(mockedList).toHaveBeenCalledTimes(3);
  });

  it('a failed refresh of an empty list shows the banner above the empty state', async () => {
    mockedList
      .mockResolvedValueOnce({ items: [], next_cursor: null })
      .mockRejectedValueOnce(new FoodLogAppError('network'));
    await renderScreen();
    await screen.findByText(FOOD_LOG_EMPTY);

    await act(async () => {
      await client.refetchQueries({ queryKey: ['food-log', 'mine'] });
    });
    expect(await screen.findByText(NETWORK)).toBeOnTheScreen();
    expect(screen.getByText(FOOD_LOG_EMPTY)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try refreshing again' })).toBeOnTheScreen();
  });
});
