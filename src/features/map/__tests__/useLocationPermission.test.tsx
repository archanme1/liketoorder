import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';

import { POSITION_TIMEOUT_MS, useLocationPermission } from '../hooks/useLocationPermission';

const services = jest.mocked(Location.hasServicesEnabledAsync);
const getPermission = jest.mocked(Location.getForegroundPermissionsAsync);
const requestPermission = jest.mocked(Location.requestForegroundPermissionsAsync);
const getPosition = jest.mocked(Location.getCurrentPositionAsync);

function permission(status: string, canAskAgain = true) {
  getPermission.mockResolvedValue({
    status,
    canAskAgain,
    granted: status === 'granted',
  } as Location.LocationPermissionResponse);
}

afterEach(() => {
  jest.useRealTimers();
});

describe('useLocationPermission state', () => {
  it.each([
    ['undetermined', true, 'undetermined'],
    ['granted', true, 'granted'],
    ['denied', true, 'denied'],
    ['denied', false, 'denied_forever'],
  ])('maps %s (canAskAgain %s) to %s', async (status, canAskAgain, expected) => {
    permission(status, canAskAgain);
    const { result } = await renderHook(() => useLocationPermission());
    await waitFor(() => expect(result.current.state).toBe(expected));
  });

  it('reports services_off before anything else', async () => {
    services.mockResolvedValueOnce(false);
    permission('granted');
    const { result } = await renderHook(() => useLocationPermission());
    await waitFor(() => expect(result.current.state).toBe('services_off'));
  });

  it('treats an unreadable state as denied, never a crash', async () => {
    getPermission.mockRejectedValueOnce(new Error('boom'));
    const { result } = await renderHook(() => useLocationPermission());
    await waitFor(() => expect(result.current.state).toBe('denied'));
  });

  it('shows the note only when never asked and not dismissed, and dismisses for good', async () => {
    permission('undetermined');
    const { result } = await renderHook(() => useLocationPermission());
    await waitFor(() => expect(result.current.showPrompt).toBe(true));
    await act(async () => result.current.dismissPrompt());
    expect(result.current.showPrompt).toBe(false);

    const again = await renderHook(() => useLocationPermission());
    await waitFor(() => expect(again.result.current.state).toBe('undetermined'));
    await act(async () => undefined);
    expect(again.result.current.showPrompt).toBe(false);
  });

  it('does not show the note once permission was answered', async () => {
    permission('denied', false);
    const { result } = await renderHook(() => useLocationPermission());
    await waitFor(() => expect(result.current.state).toBe('denied_forever'));
    expect(result.current.showPrompt).toBe(false);
  });

  it('request() shows the system prompt and returns the new state', async () => {
    permission('undetermined');
    const { result } = await renderHook(() => useLocationPermission());
    await waitFor(() => expect(result.current.state).toBe('undetermined'));
    permission('granted');
    let next;
    await act(async () => {
      next = await result.current.request();
    });
    expect(requestPermission).toHaveBeenCalled();
    expect(next).toBe('granted');
    expect(result.current.state).toBe('granted');
  });
});

describe('useLocationPermission getPosition', () => {
  it('returns only latitude and longitude', async () => {
    getPosition.mockResolvedValueOnce({
      coords: { latitude: 1, longitude: 2, altitude: 3, accuracy: 4 },
      timestamp: 1,
    } as Location.LocationObject);
    const { result } = await renderHook(() => useLocationPermission());
    let position;
    await act(async () => {
      position = await result.current.getPosition();
    });
    expect(position).toEqual({ latitude: 1, longitude: 2 });
  });

  it('gives up after 5 seconds without a fix', async () => {
    expect(POSITION_TIMEOUT_MS).toBe(5000);
    jest.useFakeTimers();
    getPosition.mockReturnValueOnce(new Promise(() => undefined));
    const { result } = await renderHook(() => useLocationPermission());
    let position: unknown = 'pending';
    const call = result.current.getPosition().then((value) => {
      position = value;
    });
    await act(async () => {
      jest.advanceTimersByTime(POSITION_TIMEOUT_MS - 1);
    });
    expect(position).toBe('pending');
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    await call;
    expect(position).toBeNull();
  });

  it('returns null when the fix fails', async () => {
    getPosition.mockRejectedValueOnce(new Error('no fix'));
    const { result } = await renderHook(() => useLocationPermission());
    let position: unknown = 'pending';
    await act(async () => {
      position = await result.current.getPosition();
    });
    expect(position).toBeNull();
  });
});
