import { focusManager } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { onAppStateChange, useAppFocus } from '../appFocus';

// Spec 06 Decision 15: stale signed URLs renew when the app returns to the foreground, which needs
// AppState wired to react-query's focusManager.

afterEach(() => {
  jest.restoreAllMocks();
  focusManager.setFocused(undefined);
});

test('foreground marks react-query focused, background unfocused', () => {
  onAppStateChange('active');
  expect(focusManager.isFocused()).toBe(true);
  onAppStateChange('background');
  expect(focusManager.isFocused()).toBe(false);
  onAppStateChange('inactive');
  expect(focusManager.isFocused()).toBe(false);
});

test('useAppFocus subscribes to AppState changes and unsubscribes on unmount', async () => {
  const remove = jest.fn();
  const addEventListener = jest
    .spyOn(AppState, 'addEventListener')
    .mockReturnValue({ remove } as ReturnType<typeof AppState.addEventListener>);

  const { unmount } = await renderHook(() => useAppFocus());
  expect(addEventListener).toHaveBeenCalledWith('change', onAppStateChange);

  await unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});
