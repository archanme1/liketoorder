import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { listCuisines } from '@/features/cuisines/api';
import { signedUrls } from '@/features/media/api';

import { CUISINES, foodLog, testClientOptions } from '../__fixtures__/foodLog';
import { claimFoodLogCleanup, deleteFoodLog, FoodLogAppError, getFoodLog } from '../api';
import { FoodLogDetailScreen } from '../components/FoodLogDetailScreen';
import { FOOD_LOG_NOT_FOUND } from '../messages';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getFoodLog: jest.fn(),
  deleteFoodLog: jest.fn(),
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

const mockedGet = jest.mocked(getFoodLog);
const mockedDelete = jest.mocked(deleteFoodLog);
const mockedClaim = jest.mocked(claimFoodLogCleanup);
const mockedSigned = jest.mocked(signedUrls);
const mockedCuisines = jest.mocked(listCuisines);

const LOG = foodLog(1, { description: 'Fresh pasta with basil', is_public: false });
const PHOTO_LABEL = 'Food photo, Italy, Sat, Nov 14, 2026. Opens full image.';

let client: QueryClient;
let alertSpy: jest.SpyInstance;

async function renderDetail(id = LOG.id) {
  client = new QueryClient(testClientOptions());
  client.setQueryDefaults(['cuisines'], { gcTime: Infinity });
  client.setQueryData(['cuisines'], CUISINES);
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <QueryClientProvider client={client}>
        <FoodLogDetailScreen id={id} />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockedCuisines.mockResolvedValue(CUISINES);
  mockedClaim.mockResolvedValue([]);
  mockedSigned.mockImplementation(async (_bucket, paths) =>
    Object.fromEntries(paths.map((p) => [p, `https://signed.example/${p}`])),
  );
});

afterEach(async () => {
  await cleanup();
  client.clear();
  alertSpy.mockRestore();
  jest.clearAllMocks();
});

describe('FoodLogDetailScreen states', () => {
  it('shows a loading state', async () => {
    let finish: (value: typeof LOG) => void = () => {};
    mockedGet.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await renderDetail();
    expect(screen.getByLabelText('Loading photo')).toBeOnTheScreen();
    // Let the load finish inside the test so nothing lands after cleanup.
    await act(async () => finish(LOG));
    expect(await screen.findByRole('button', { name: PHOTO_LABEL })).toBeOnTheScreen();
    await waitFor(() => expect(mockedSigned).toHaveBeenCalled());
  });

  it('shows an error with Try again, which loads the photo', async () => {
    mockedGet.mockRejectedValueOnce(new FoodLogAppError('network')).mockResolvedValue(LOG);
    await renderDetail();
    await fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: PHOTO_LABEL })).toBeOnTheScreen();
  });

  it('shows the photo, the full description, the cuisine, the date and Private as a word', async () => {
    mockedGet.mockResolvedValue(LOG);
    await renderDetail();
    expect(await screen.findByRole('button', { name: PHOTO_LABEL })).toBeOnTheScreen();
    expect(screen.getByText('Fresh pasta with basil')).toBeOnTheScreen();
    expect(screen.getByLabelText('Italy')).toBeOnTheScreen();
    expect(screen.getByText('Sat, Nov 14, 2026')).toBeOnTheScreen();
    expect(screen.getByText('Private')).toBeOnTheScreen();
    await waitFor(() => expect(mockedSigned).toHaveBeenCalledWith('food-logs', [LOG.path], 3600));
  });

  it('says Public for a public log', async () => {
    mockedGet.mockResolvedValue({ ...LOG, is_public: true });
    await renderDetail();
    expect(await screen.findByText('Public')).toBeOnTheScreen();
  });

  it.each([
    [
      'an unknown or deleted id',
      () => mockedGet.mockRejectedValue(new FoodLogAppError('not_found')),
    ],
    [
      "someone else's public log",
      () => mockedGet.mockResolvedValue({ ...LOG, is_public: true, is_mine: false, path: null }),
    ],
    ['a malformed id', () => mockedGet.mockRejectedValue(new FoodLogAppError('not_found'))],
  ])('shows the same not-found for %s, with Back', async (_name, arrange) => {
    arrange();
    await renderDetail();
    expect(await screen.findByText(FOOD_LOG_NOT_FOUND)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Delete this photo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(mockedSigned).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

describe('FoodLogDetailScreen actions', () => {
  it('opens the full image', async () => {
    mockedGet.mockResolvedValue(LOG);
    await renderDetail();
    await fireEvent.press(await screen.findByRole('button', { name: PHOTO_LABEL }));
    expect(await screen.findByRole('button', { name: /close/i })).toBeOnTheScreen();
  });

  it('Edit opens the edit form', async () => {
    mockedGet.mockResolvedValue(LOG);
    await renderDetail();
    await fireEvent.press(await screen.findByRole('button', { name: 'Edit this photo' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/food-log/[id]/edit',
      params: { id: LOG.id },
    });
  });

  it('Delete asks first; Cancel deletes nothing', async () => {
    mockedGet.mockResolvedValue(LOG);
    await renderDetail();
    await fireEvent.press(await screen.findByRole('button', { name: 'Delete this photo' }));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe('Delete this photo?');
    expect(message).toBe("This can't be undone.");
    expect(buttons.map((b: { text: string }) => b.text)).toEqual(['Cancel', 'Delete']);
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('a confirmed delete closes the screen without a not-found flash', async () => {
    mockedGet.mockResolvedValue(LOG);
    mockedDelete.mockResolvedValue();
    await renderDetail();
    await fireEvent.press(await screen.findByRole('button', { name: 'Delete this photo' }));
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find((b) => b.text === 'Delete')?.onPress?.());

    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
    expect(mockedDelete).toHaveBeenCalledWith(LOG.id);
    expect(screen.queryByText(FOOD_LOG_NOT_FOUND)).toBeNull();
    expect(mockedGet).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockedClaim).toHaveBeenCalled());
  });

  it('a failed delete stays on the screen with a message', async () => {
    mockedGet.mockResolvedValue(LOG);
    mockedDelete.mockRejectedValue(new FoodLogAppError('network'));
    await renderDetail();
    await fireEvent.press(await screen.findByRole('button', { name: 'Delete this photo' }));
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find((b) => b.text === 'Delete')?.onPress?.());
    expect(await screen.findByText(/Can't reach LikeToOrder/)).toBeOnTheScreen();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });
});
