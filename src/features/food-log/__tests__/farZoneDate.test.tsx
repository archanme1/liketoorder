import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react-native';
import { getCalendars } from 'expo-localization';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { listCuisines } from '@/features/cuisines/api';
import { signedUrls } from '@/features/media/api';

import { CUISINES, foodLog, testClientOptions } from '../__fixtures__/foodLog';
import { claimFoodLogCleanup, getFoodLog, listMyFoodLogs } from '../api';
import { FoodLogDetailScreen } from '../components/FoodLogDetailScreen';
import { FoodLogListScreen } from '../components/FoodLogListScreen';

// The date shown is the stored local_date, never created_at in the phone's zone (spec 13 Known
// pitfalls). The phone is put far from UTC (getCalendars and the default Intl zone), and created_at
// is two days after local_date, so it lands on Nov 16 or 17 in every real zone: only local_date
// can give Nov 14.

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  listMyFoodLogs: jest.fn(),
  getFoodLog: jest.fn(),
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

const FAR_ZONE = 'Pacific/Kiritimati';
const LOG = foodLog(1, {
  local_date: '2026-11-14',
  created_at: '2026-11-16T12:00:00.000000+00:00',
});
const SHOWN = 'Sat, Nov 14, 2026';

let client: QueryClient | undefined;
let intlSpy: jest.SpyInstance;

async function renderWithClient(ui: ReactElement) {
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
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest
    .mocked(getCalendars)
    .mockReturnValue([
      { calendar: 'gregory', timeZone: FAR_ZONE, uses24hourClock: false, firstWeekday: 1 },
    ] as ReturnType<typeof getCalendars>);
  // The phone's default zone for any formatter that doesn't name one.
  const original = Intl.DateTimeFormat;
  intlSpy = jest
    .spyOn(Intl, 'DateTimeFormat')
    .mockImplementation((locale, options) => original(locale, { timeZone: FAR_ZONE, ...options }));
  jest.mocked(listCuisines).mockResolvedValue(CUISINES);
  jest.mocked(claimFoodLogCleanup).mockResolvedValue([]);
  jest.mocked(listMyFoodLogs).mockResolvedValue({ items: [LOG], next_cursor: null });
  jest.mocked(getFoodLog).mockResolvedValue(LOG);
  jest
    .mocked(signedUrls)
    .mockImplementation(async (_bucket, paths) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed.example/${p}`])),
    );
});

afterEach(async () => {
  await cleanup();
  client?.clear();
  intlSpy.mockRestore();
  jest
    .mocked(getCalendars)
    .mockReturnValue([
      { calendar: 'gregory', timeZone: 'UTC', uses24hourClock: false, firstWeekday: 1 },
    ] as ReturnType<typeof getCalendars>);
  jest.clearAllMocks();
});

describe('the date shown is local_date, with the phone far from UTC', () => {
  it('the phone really is in the far zone for this test', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(FAR_ZONE);
    expect(
      new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
        new Date(LOG.created_at),
      ),
    ).toBe('Nov 17');
  });

  it('on the list row', async () => {
    await renderWithClient(<FoodLogListScreen />);
    expect(
      await screen.findByRole('button', { name: `Food photo, Italy, ${SHOWN}. Meal 1.` }),
    ).toBeOnTheScreen();
    expect(screen.getByText(SHOWN, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText(/Nov 1[67]/, { includeHiddenElements: true })).toBeNull();
  });

  it('on the detail page', async () => {
    await renderWithClient(<FoodLogDetailScreen id={LOG.id} />);
    expect(await screen.findByText(SHOWN)).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: `Food photo, Italy, ${SHOWN}. Opens full image.` }),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/Nov 1[67]/, { includeHiddenElements: true })).toBeNull();
  });
});
