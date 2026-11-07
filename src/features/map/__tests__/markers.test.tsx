import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Pressable , StyleSheet } from 'react-native';

import type { Cuisine } from '@/features/cuisines/schema';

import { ClusterMarker, clusterDiameter, clusterLabel } from '../components/ClusterMarker';
import { FlagMarker, markerLabel } from '../components/FlagMarker';
import { TRACK_VIEW_MS } from '../hooks/useTracksViewChanges';
import type { Pin } from '../schema';

const pin: Pin = { id: 'p1', name: "Joe's Pizza", cuisine_code: 'IT', lat: 43.5, lng: -79.4 };
const italy: Cuisine = {
  kind: 'country',
  code: 'IT',
  name: 'Italy',
  flag: '🇮🇹',
  icon: null,
  sort_order: 1,
};
const streetFood: Cuisine = {
  kind: 'neutral',
  code: 'street-food',
  name: 'Street food',
  flag: null,
  icon: 'restaurant-outline',
  sort_order: 2,
};

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never);

afterEach(() => {
  jest.useRealTimers();
});

describe('FlagMarker', () => {
  it('is a button named "<Name>, <Cuisine> cuisine"', async () => {
    await render(<FlagMarker pin={pin} cuisine={italy} selected={false} onSelect={jest.fn()} />);
    expect(screen.getByRole('button', { name: "Joe's Pizza, Italy cuisine" })).toBeOnTheScreen();
    expect(markerLabel(pin.name, italy)).toBe("Joe's Pizza, Italy cuisine");
  });

  it('falls back to just the name while the cuisine list loads', async () => {
    await render(
      <FlagMarker pin={pin} cuisine={undefined} selected={false} onSelect={jest.fn()} />,
    );
    expect(screen.getByRole('button', { name: "Joe's Pizza" })).toBeOnTheScreen();
  });

  it('shows the flag for a country cuisine', async () => {
    await render(<FlagMarker pin={pin} cuisine={italy} selected={false} onSelect={jest.fn()} />);
    expect(screen.getByText('🇮🇹', { includeHiddenElements: true })).toBeTruthy();
  });

  it('shows an icon, not a flag, for a neutral cuisine', async () => {
    await render(
      <FlagMarker pin={pin} cuisine={streetFood} selected={false} onSelect={jest.fn()} />,
    );
    const icons = screen.container.queryAll((node) => node.props.name === 'restaurant-outline');
    expect(icons.length).toBeGreaterThanOrEqual(1);
  });

  it('reports the pressed pin', async () => {
    const onSelect = jest.fn();
    await render(<FlagMarker pin={pin} cuisine={italy} selected={false} onSelect={onSelect} />);
    await fireEvent.press(screen.getByRole('button', { name: /Joe's Pizza/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(pin);
  });

  it('puts the marker at the pin', async () => {
    await render(<FlagMarker pin={pin} cuisine={italy} selected={false} onSelect={jest.fn()} />);
    expect(screen.getByRole('button', { name: /Joe's Pizza/ }).props.coordinate).toEqual({
      latitude: 43.5,
      longitude: -79.4,
    });
  });

  it('has a touch target of at least 44 around the pill', async () => {
    await render(<FlagMarker pin={pin} cuisine={italy} selected={false} onSelect={jest.fn()} />);
    const hit = flat(screen.getByTestId('flag-hit'));
    expect(hit.width).toBeGreaterThanOrEqual(44);
    expect(hit.height).toBeGreaterThanOrEqual(44);
  });

  it('shows the selected marker with a darker, thicker ring, not a bigger one', async () => {
    const { rerender } = await render(
      <FlagMarker pin={pin} cuisine={italy} selected={false} onSelect={jest.fn()} />,
    );
    const normal = flat(screen.getByTestId('flag-pill'));
    await rerender(<FlagMarker pin={pin} cuisine={italy} selected onSelect={jest.fn()} />);
    const selected = flat(screen.getByTestId('flag-pill'));
    expect(selected.borderWidth).toBeGreaterThan(normal.borderWidth as number);
    expect(selected.borderColor).not.toBe(normal.borderColor);
    expect(selected.width).toBe(normal.width);
    expect(selected.height).toBe(normal.height);
    expect(selected.minWidth).toBe(normal.minWidth);
  });

  it('stops tracking view changes once drawn, and tracks again after it changes', async () => {
    jest.useFakeTimers();
    const { rerender } = await render(
      <FlagMarker pin={pin} cuisine={italy} selected={false} onSelect={jest.fn()} />,
    );
    const marker = () => screen.getByRole('button', { name: /Joe's Pizza/ });
    expect(marker().props.tracksViewChanges).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(TRACK_VIEW_MS - 1);
    });
    expect(marker().props.tracksViewChanges).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(marker().props.tracksViewChanges).toBe(false);
    await rerender(<FlagMarker pin={pin} cuisine={italy} selected onSelect={jest.fn()} />);
    expect(marker().props.tracksViewChanges).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(TRACK_VIEW_MS);
    });
    expect(marker().props.tracksViewChanges).toBe(false);
  });
});

const cluster = {
  clusterId: 7,
  latitude: 43.6,
  longitude: -79.4,
  count: 12,
};

describe('ClusterMarker', () => {
  it('says how many places and what a tap does', async () => {
    await render(<ClusterMarker {...cluster} onPress={jest.fn()} />);
    expect(
      screen.getByRole('button', { name: '12 places, double tap to zoom in' }),
    ).toBeOnTheScreen();
    expect(clusterLabel(12)).toBe('12 places, double tap to zoom in');
    expect(screen.getByText('12')).toBeOnTheScreen();
  });

  it('reports the cluster id when pressed', async () => {
    const onPress = jest.fn();
    await render(<ClusterMarker {...cluster} onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: /12 places/ }));
    expect(onPress).toHaveBeenCalledWith(7);
  });

  it('grows with the count, between 36 and 48', () => {
    const sizes = { clusterSm: 36, clusterMd: 42, clusterLg: 48 };
    expect(clusterDiameter(2, sizes)).toBe(36);
    expect(clusterDiameter(9, sizes)).toBe(36);
    expect(clusterDiameter(10, sizes)).toBe(42);
    expect(clusterDiameter(99, sizes)).toBe(42);
    expect(clusterDiameter(100, sizes)).toBe(48);
  });

  it('keeps a touch target of at least 44 even for the smallest circle', async () => {
    await render(<ClusterMarker {...cluster} count={3} onPress={jest.fn()} />);
    expect(flat(screen.getByTestId('cluster-circle')).width).toBe(36);
    expect(flat(screen.getByTestId('cluster-hit')).width).toBeGreaterThanOrEqual(44);
    expect(flat(screen.getByTestId('cluster-hit')).height).toBeGreaterThanOrEqual(44);
  });
});

describe('marker props stay stable when the map re-renders', () => {
  // A parent that re-renders (as the map screen does on every camera move) and hands over
  // freshly built but equal values, the way the cluster list does.
  function Parent({ kind }: { kind: 'cluster' | 'flag' }) {
    const [tick, setTick] = useState(0);
    const onPress = useCallbackStable();
    return (
      <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="rerender"
          onPress={() => setTick(tick + 1)}
        />
        {kind === 'cluster' ? (
          <ClusterMarker
            clusterId={cluster.clusterId}
            count={cluster.count}
            latitude={cluster.latitude}
            longitude={cluster.longitude}
            onPress={onPress}
          />
        ) : (
          <FlagMarker pin={pin} cuisine={italy} selected={false} onSelect={onPress} />
        )}
      </>
    );
  }
  const stable = jest.fn();
  const useCallbackStable = () => stable;

  it.each(['cluster', 'flag'] as const)('%s: same coordinate and press handler', async (kind) => {
    await render(<Parent kind={kind} />);
    const first = screen.getByTestId('marker').props;
    await fireEvent.press(screen.getByRole('button', { name: 'rerender' }));
    const second = screen.getByTestId('marker').props;
    expect(second.coordinate).toBe(first.coordinate);
    expect(second.onPress).toBe(first.onPress);
  });
});
