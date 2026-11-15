import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { listCuisines } from '@/features/cuisines/api';
import { signedUrls } from '@/features/media/api';

import { CUISINES, foodLog, testClientOptions } from '../__fixtures__/foodLog';
import { claimFoodLogCleanup, deleteFoodLog, getFoodLog, listMyFoodLogs } from '../api';
import { FoodLogDetailScreen } from '../components/FoodLogDetailScreen';
import { FoodLogListScreen } from '../components/FoodLogListScreen';

// The list stays mounted under the detail page in the Stack. A delete from the detail must
// refresh the list, so the deleted photo is gone when the person comes back.

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
  listMyFoodLogs: jest.fn(),
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

const mockedList = jest.mocked(listMyFoodLogs);
const mockedDelete = jest.mocked(deleteFoodLog);

const KEPT = foodLog(1);
const DELETED = foodLog(2);

let client: QueryClient;
let alertSpy: jest.SpyInstance;

beforeEach(() => {
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(listCuisines).mockResolvedValue(CUISINES);
  jest.mocked(claimFoodLogCleanup).mockResolvedValue([]);
  jest.mocked(getFoodLog).mockResolvedValue(DELETED);
  jest
    .mocked(signedUrls)
    .mockImplementation(async (_bucket, paths) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed.example/${p}`])),
    );
  // The server's list before and after the delete.
  mockedList.mockImplementation(async () => ({
    items: mockedDelete.mock.calls.length > 0 ? [KEPT] : [KEPT, DELETED],
    next_cursor: null,
  }));
  mockedDelete.mockResolvedValue();
});

afterEach(async () => {
  await cleanup();
  client.clear();
  alertSpy.mockRestore();
  jest.clearAllMocks();
});

describe('stale list after a delete', () => {
  it('the deleted photo leaves the list underneath', async () => {
    client = new QueryClient(testClientOptions());
    client.setQueryDefaults(['cuisines'], { gcTime: Infinity });
    client.setQueryData(['cuisines'], CUISINES);
    await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <QueryClientProvider client={client}>
          <View>
            <FoodLogListScreen />
          </View>
          <FoodLogDetailScreen id={DELETED.id} />
        </QueryClientProvider>
      </SafeAreaProvider>,
    );

    expect(await screen.findByRole('button', { name: /Meal 2\./ })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /Meal 1\./ })).toBeOnTheScreen();

    await fireEvent.press(await screen.findByRole('button', { name: 'Delete this photo' }));
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find((b) => b.text === 'Delete')?.onPress?.());

    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('button', { name: /Meal 2\./ })).toBeNull());
    expect(screen.getByRole('button', { name: /Meal 1\./ })).toBeOnTheScreen();
    expect(mockedList).toHaveBeenCalledTimes(2);
  });
});
