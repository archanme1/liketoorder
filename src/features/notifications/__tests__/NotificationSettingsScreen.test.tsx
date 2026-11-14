import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthContext, type AuthContextValue } from '@/features/auth/components/AuthProvider';
import { getMyBusiness } from '@/features/sellers/api';
import type { MyBusiness } from '@/features/sellers/schema';
import { supabase } from '@/lib/supabase';

import { NotificationSettingsScreen } from '../components/NotificationSettingsScreen';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('@/features/sellers/api', () => ({
  ...jest.requireActual('@/features/sellers/api'),
  getMyBusiness: jest.fn(),
}));

const db = supabase as unknown as { rpc: jest.Mock };
const businessMock = jest.mocked(getMyBusiness);
const getPermission = jest.mocked(Notifications.getPermissionsAsync);
const defaultGet = getPermission.getMockImplementation();

type Row = { answers: boolean; new_requests: boolean; cancellations: boolean; arrivals: boolean };
const ALL_ON: Row = { answers: true, new_requests: true, cancellations: true, arrivals: true };
const ARGS_TO_ROW = (args: Record<string, boolean>): Row => ({
  answers: args.p_answers,
  new_requests: args.p_new_requests,
  cancellations: args.p_cancellations,
  arrivals: args.p_arrivals,
});

function permission(status: 'undetermined' | 'granted' | 'denied') {
  getPermission.mockResolvedValue({
    status,
    granted: status === 'granted',
    canAskAgain: status !== 'denied',
    expires: 'never',
  } as Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>);
}

/** The server: get returns `stored`; set saves and returns it, unless `setResult` overrides. */
let stored: Row;
let setResult: ((args: Record<string, boolean>) => Promise<unknown>) | null;
function serve() {
  db.rpc.mockImplementation(async (name: string, args: Record<string, boolean>) => {
    if (name === 'get_notification_settings') return { data: stored, error: null };
    if (name === 'set_notification_settings') {
      if (setResult) return setResult(args);
      stored = ARGS_TO_ROW(args);
      return { data: stored, error: null };
    }
    return { data: null, error: { code: 'P0001', message: 'unknown' } };
  });
}

const authValue: AuthContextValue = {
  session: { user: { id: 'user-1' } } as unknown as AuthContextValue['session'],
  isLoading: false,
  isRecovering: false,
  notice: null,
  prepareRecovery: jest.fn(),
  abandonRecovery: jest.fn(),
  markRecovering: jest.fn(),
  clearRecovering: jest.fn(),
  dismissNotice: jest.fn(),
};

// Without starting metrics SafeAreaProvider renders nothing under jest.
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

let client: QueryClient;
async function show() {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <AuthContext.Provider value={authValue}>
        <QueryClientProvider client={client}>
          <NotificationSettingsScreen />
        </QueryClientProvider>
      </AuthContext.Provider>
    </SafeAreaProvider>,
  );
}

const switchFor = (name: string) => screen.findByRole('switch', { name });
const setCalls = () => db.rpc.mock.calls.filter(([name]) => name === 'set_notification_settings');

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });
  stored = { ...ALL_ON };
  setResult = null;
  serve();
  businessMock.mockResolvedValue(null);
  permission('granted');
});

afterEach(async () => {
  await cleanup();
  client.clear();
  getPermission.mockImplementation(defaultGet);
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('NotificationSettingsScreen: the switches', () => {
  it('shows a loading state, then a customer only the answers switch, on, as a word', async () => {
    await show();
    expect(screen.getByLabelText('Loading notification settings')).toBeOnTheScreen();
    const answers = await switchFor('Answers to my requests');
    expect(answers).toBeChecked();
    // The visible word (hidden from screen readers, which hear the switch state instead).
    expect(screen.getByText('On', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByRole('switch', { name: 'New requests' })).toBeNull();
  });

  it('shows a business owner all four switches (Decision 4)', async () => {
    businessMock.mockResolvedValue({ id: 'b1' } as unknown as MyBusiness);
    await show();
    for (const name of [
      'Answers to my requests',
      'New requests',
      'Cancelled requests',
      'Customer arrived',
    ]) {
      expect(await switchFor(name)).toBeOnTheScreen();
    }
  });

  it('shows an error with Try again, and recovers', async () => {
    db.rpc.mockImplementationOnce(async () => ({
      data: null,
      error: { message: 'Network request failed' },
    }));
    await show();
    expect(
      await screen.findByText("You're offline. Check your connection and try again."),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await switchFor('Answers to my requests')).toBeOnTheScreen();
  });

  it('a switch moves at once and saves all four switches', async () => {
    businessMock.mockResolvedValue({ id: 'b1' } as unknown as MyBusiness);
    let release: () => void = () => undefined;
    setResult = (args) =>
      new Promise((resolve) => {
        release = () => {
          stored = ARGS_TO_ROW(args);
          resolve({ data: stored, error: null });
        };
      });
    await show();
    await fireEvent(await switchFor('New requests'), 'valueChange', false);
    // Optimistic: off before the server answers.
    await waitFor(async () =>
      expect(await switchFor('New requests')).not.toBeChecked(),
    );
    await waitFor(() => expect(setCalls()).toHaveLength(1));
    expect(setCalls()[0][1]).toEqual({
      p_answers: true,
      p_new_requests: false,
      p_cancellations: true,
      p_arrivals: true,
    });
    release();
    await waitFor(async () =>
      expect(await switchFor('New requests')).not.toBeChecked(),
    );
  });

  it('a failed save moves the switch back and says so', async () => {
    setResult = async () => ({ data: null, error: { code: 'P0001', message: 'invalid_input' } });
    await show();
    await fireEvent(await switchFor('Answers to my requests'), 'valueChange', false);
    expect(
      await screen.findByText("We couldn't save that change. It's back as it was."),
    ).toBeOnTheScreen();
    await waitFor(async () =>
      expect(await switchFor('Answers to my requests')).toBeChecked(),
    );
  });

  it('saves one after another: a quick second change waits, then carries both changes', async () => {
    businessMock.mockResolvedValue({ id: 'b1' } as unknown as MyBusiness);
    const releases: (() => void)[] = [];
    setResult = (args) =>
      new Promise((resolve) => {
        releases.push(() => {
          stored = ARGS_TO_ROW(args);
          resolve({ data: stored, error: null });
        });
      });
    await show();
    await fireEvent(await switchFor('New requests'), 'valueChange', false);
    await fireEvent(await switchFor('Customer arrived'), 'valueChange', false);
    await waitFor(() => expect(setCalls()).toHaveLength(1));
    // The second save has not started while the first is out.
    expect(setCalls()).toHaveLength(1);
    releases[0]();
    await waitFor(() => expect(setCalls()).toHaveLength(2));
    expect(ARGS_TO_ROW(setCalls()[1][1])).toEqual({
      answers: true,
      new_requests: false,
      cancellations: true,
      arrivals: false,
    });
    releases[1]();
    await waitFor(async () =>
      expect(await switchFor('Customer arrived')).not.toBeChecked(),
    );
    expect(await switchFor('New requests')).not.toBeChecked();
  });
});

describe('NotificationSettingsScreen: the phone permission', () => {
  it('never asked: offers the primer (as an owner when they own a business)', async () => {
    permission('undetermined');
    businessMock.mockResolvedValue({ id: 'b1' } as unknown as MyBusiness);
    await show();
    expect(await screen.findByText('Notifications are off.')).toBeOnTheScreen();
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'New requests' })).toBeOnTheScreen(),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Turn on notifications' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/notifications/allow',
      params: { role: 'owner' },
    });
  });

  it("denied: says so in words and opens the phone's Settings", async () => {
    permission('denied');
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await show();
    expect(
      await screen.findByText("Notifications are off in your phone's Settings."),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('granted: no permission panel, just the switches', async () => {
    await show();
    expect(await switchFor('Answers to my requests')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Turn on notifications' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
  });

  it('Back goes back to Profile', async () => {
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Back to Profile' }));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});
