import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { listCuisines } from '@/features/cuisines/api';
import { signedUrls } from '@/features/media/api';
import { size } from '@/theme/tokens';

import {
  activityJson,
  CUISINES,
  dayJson,
  foodLog,
  resetModuleMocks,
  testClientOptions,
} from '../__fixtures__/foodLog';
import { getMyFoodLogActivity, listMyFoodLogsOn } from '../api';
import { ActivitySection } from '../components/ActivitySection';

// Spec 14 Decision 11: grid squares are 14 pt, the one exception to the 44 pt rule. Every action a
// square offers (choose a day, move between days, open an upload) must also be reachable through
// 44 pt controls. This test never presses a square.

type Element = ReturnType<typeof screen.getByText>;

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getMyFoodLogActivity: jest.fn(),
  listMyFoodLogsOn: jest.fn(),
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

const LOGS: Record<string, ReturnType<typeof foodLog>> = {
  '2026-11-11': foodLog(11, { local_date: '2026-11-11', description: 'Ramen' }),
  '2026-11-12': foodLog(12, { local_date: '2026-11-12', description: 'Pizza' }),
};

let client: QueryClient;

beforeEach(() => {
  jest.mocked(listCuisines).mockResolvedValue(CUISINES);
  jest
    .mocked(signedUrls)
    .mockImplementation(async (_bucket, paths) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed.example/${p}`])),
    );
  jest.mocked(getMyFoodLogActivity).mockResolvedValue(activityJson());
  jest
    .mocked(listMyFoodLogsOn)
    .mockImplementation(async (date) => dayJson(LOGS[date] ? [LOGS[date]] : []));
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
  resetModuleMocks('../api', '@/features/media/api', '@/features/cuisines/api');
});

/** Presses a control, refusing any grid square. */
async function pressControl(element: Element) {
  expect(String(element.props.testID ?? '')).not.toMatch(/^activity-cell-/);
  await fireEvent.press(element);
}

/** The control is at least 44 x 44 pt (size.touch). */
function expectTouchSize(element: Element) {
  const style = StyleSheet.flatten(element.props.style);
  expect(style.minHeight).toBeGreaterThanOrEqual(size.touch);
  expect(style.minWidth).toBeGreaterThanOrEqual(size.touch);
}

describe('44 pt alternatives to the grid squares (Decision 11)', () => {
  it('reaches every grid action without pressing a square, through 44 pt controls', async () => {
    client = new QueryClient(testClientOptions());
    await render(
      <QueryClientProvider client={client}>
        <ActivitySection weeks={17} showFullYear />
      </QueryClientProvider>,
    );

    // Choose a day from the list view.
    await pressControl(await screen.findByRole('button', { name: 'Show as list' }));
    const listRow = screen.getByRole('button', { name: 'Nov 11, 4 uploads' });
    expectTouchSize(listRow);
    await pressControl(listRow);
    expect(await screen.findByRole('header', { name: 'Wed, Nov 11, 2026' })).toBeTruthy();

    // Move with Next day and Previous day.
    const next = screen.getByRole('button', { name: 'Next day' });
    const previous = screen.getByRole('button', { name: 'Previous day' });
    expectTouchSize(next);
    expectTouchSize(previous);
    await pressControl(next);
    expect(await screen.findByRole('header', { name: 'Thu, Nov 12, 2026' })).toBeTruthy();
    const pizza = await screen.findByRole('button', { name: 'Food photo, Italy. Pizza.' });
    await pressControl(screen.getByRole('button', { name: 'Previous day' }));
    expect(await screen.findByRole('header', { name: 'Wed, Nov 11, 2026' })).toBeTruthy();

    // Open an upload from a panel row.
    const ramen = await screen.findByRole('button', { name: 'Food photo, Italy. Ramen.' });
    expectTouchSize(ramen);
    expectTouchSize(pizza);
    await pressControl(ramen);
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/food-log/[id]',
      params: { id: LOGS['2026-11-11'].id },
    });
  });
});
