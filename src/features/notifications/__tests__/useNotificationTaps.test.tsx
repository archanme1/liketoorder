import { act, cleanup, renderHook } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';

import { resetHandledTapsForTests, useNotificationTaps } from '../hooks/useNotificationTaps';

import {
  REQUEST_UUID,
  fakeNotifications,
  makeResponse,
  pushData,
} from '../__fixtures__/notifications';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

afterEach(async () => {
  await cleanup();
  resetHandledTapsForTests();
  jest.clearAllMocks();
});

const toResolver = (kind: string, side: string) => ({
  pathname: '/notifications/open',
  params: { v: '1', kind, id: REQUEST_UUID, side },
});

describe('useNotificationTaps', () => {
  it('cold start: routes the tap that opened the app to the resolver, once, and clears it', async () => {
    fakeNotifications.__setLastResponse(
      makeResponse(pushData({ kind: 'table', side: 'received' })),
    );
    await renderHook(() => useNotificationTaps());
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith(toResolver('table', 'received'));
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
    expect(Notifications.getLastNotificationResponse()).toBeNull();
  });

  it('warm: routes a tap while the app is running', async () => {
    await renderHook(() => useNotificationTaps());
    expect(mockRouter.push).not.toHaveBeenCalled();
    await act(async () => fakeNotifications.__emitResponse(makeResponse(pushData())));
    expect(mockRouter.push).toHaveBeenCalledWith(toResolver('pickup', 'sent'));
  });

  it('one tap routes once: the same notification reported twice, or after a re-mount', async () => {
    const response = makeResponse(pushData(), undefined, 'same-notification');
    fakeNotifications.__setLastResponse(response);
    const first = await renderHook(() => useNotificationTaps());
    await act(async () => fakeNotifications.__emitResponse(response));
    await first.unmount();
    fakeNotifications.__setLastResponse(response);
    await renderHook(() => useNotificationTaps());
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
  });

  it('two different notifications each route', async () => {
    await renderHook(() => useNotificationTaps());
    await act(async () => fakeNotifications.__emitResponse(makeResponse(pushData())));
    await act(async () =>
      fakeNotifications.__emitResponse(makeResponse(pushData({ side: 'received' }))),
    );
    expect(mockRouter.push).toHaveBeenCalledTimes(2);
  });

  it('ignores anything but a tap on the notification itself (an action button)', async () => {
    await renderHook(() => useNotificationTaps());
    await act(async () =>
      fakeNotifications.__emitResponse(makeResponse(pushData(), 'some.action')),
    );
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('a cold start from an action button routes nothing and clears the response (review S6)', async () => {
    fakeNotifications.__setLastResponse(makeResponse(pushData(), 'some.action'));
    await renderHook(() => useNotificationTaps());
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(Notifications.getLastNotificationResponse()).toBeNull();
  });

  it.each([
    ['a bad payload', { foo: 'bar' }],
    ['another version', pushData({ v: 2 })],
    ['an extra key', pushData({ note: 'call me' })],
  ])('%s goes to the Requests tab and nowhere else', async (_label, data) => {
    await renderHook(() => useNotificationTaps());
    await act(async () => fakeNotifications.__emitResponse(makeResponse(data)));
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith('/requests');
  });

  it('stops listening when unmounted', async () => {
    const view = await renderHook(() => useNotificationTaps());
    await view.unmount();
    expect(fakeNotifications.__listenerCount()).toBe(0);
  });
});
