import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';

import { NotificationsRow } from '../components/NotificationsRow';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const getPermission = jest.mocked(Notifications.getPermissionsAsync);
const defaultGet = getPermission.getMockImplementation();

function permission(status: 'undetermined' | 'granted' | 'denied') {
  getPermission.mockResolvedValue({
    status,
    granted: status === 'granted',
    canAskAgain: status !== 'denied',
    expires: 'never',
  } as Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>);
}

let client: QueryClient;
async function show() {
  await render(
    <QueryClientProvider client={client}>
      <NotificationsRow />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
  getPermission.mockImplementation(defaultGet);
  jest.clearAllMocks();
});

describe('NotificationsRow (Profile)', () => {
  it.each([
    ['granted', 'On'],
    ['undetermined', 'Off'],
    ['denied', 'Off in Settings'],
  ] as const)('permission %s reads "%s", in words', async (state, word) => {
    permission(state);
    await show();
    expect(await screen.findByRole('button', { name: `Notifications: ${word}` })).toBeOnTheScreen();
    // Also visible on screen (the row's label carries it for screen readers).
    expect(screen.getByText(word, { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('opens the notification settings', async () => {
    permission('granted');
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Notifications: On' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/profile/notifications');
  });
});
