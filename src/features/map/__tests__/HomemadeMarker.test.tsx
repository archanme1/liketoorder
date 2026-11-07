import { render, screen } from '@testing-library/react-native';
import MapView from 'react-native-maps';

import type { Cuisine } from '@/features/cuisines/schema';

import { HomemadeMarker, homemadeMarkerLabel } from '../components/HomemadeMarker';
import type { Pin } from '../schema';
import { CIRCLE_MAX_DELTA, CIRCLE_RADIUS_M } from '../region';

const italy: Cuisine = {
  kind: 'country',
  code: 'IT',
  name: 'Italy',
  flag: '🇮🇹',
  icon: null,
  sort_order: 1,
};
// A point with awkward digits: the circle must use it exactly, never a rounded or offset copy.
const cook: Pin = {
  id: 'h1',
  name: "Nonna Rosa's Table",
  cuisine_code: 'IT',
  lat: 43.89713,
  lng: -78.86583,
};

async function renderMarker(zoomedIn: boolean, onSelect = jest.fn()) {
  await render(
    <MapView>
      <HomemadeMarker
        pin={cook}
        cuisine={italy}
        selected={false}
        onSelect={onSelect}
        zoomedIn={zoomedIn}
      />
    </MapView>,
  );
}

describe('HomemadeMarker', () => {
  it('draws a 500 m circle centred exactly on the pin the server gave, when zoomed in', async () => {
    await renderMarker(true);
    const circle = screen.getByTestId('map-circle');
    expect(circle.props.radius).toBe(500);
    expect(CIRCLE_RADIUS_M).toBe(500);
    expect(circle.props.center).toEqual({ latitude: 43.89713, longitude: -78.86583 });
    expect(circle.props.fillColor).toBeTruthy();
    expect(circle.props.strokeColor).toBeTruthy();
  });

  it('draws no circle when zoomed out, but still draws the flag', async () => {
    await renderMarker(false);
    expect(screen.queryByTestId('map-circle')).not.toBeOnTheScreen();
    expect(screen.getByTestId('marker')).toBeOnTheScreen();
  });

  it('draws the flag at the same point as the circle', async () => {
    await renderMarker(true);
    expect(screen.getByTestId('marker').props.coordinate).toEqual(
      screen.getByTestId('map-circle').props.center,
    );
  });

  it('puts the circle under the flag', async () => {
    await renderMarker(true);
    expect(screen.getByTestId('map-circle').props.zIndex).toBe(0);
    expect(screen.getByTestId('marker').props.zIndex).toBeGreaterThan(0);
  });

  it('gives the circle no press: the library has none, so it cannot open or close anything', async () => {
    await renderMarker(true);
    const props = screen.getByTestId('map-circle').props;
    expect(props.onPress).toBeUndefined();
    expect(props.tappable).toBeUndefined();
    expect(props.stopPropagation).toBeUndefined();
  });

  it('names the cook, the cuisine and "homemade, approximate area"', async () => {
    await renderMarker(true);
    expect(
      screen.getByRole('button', {
        name: "Nonna Rosa's Table, Italy cuisine, homemade, approximate area",
      }),
    ).toBeOnTheScreen();
    expect(homemadeMarkerLabel('Amy', undefined)).toBe('Amy, homemade, approximate area');
  });

  it('keeps stopPropagation on the flag so its press never reaches the map', async () => {
    await renderMarker(true);
    expect(screen.getByTestId('marker').props.stopPropagation).toBe(true);
  });

  it('uses the same zoom limit as the spec (0.05)', () => {
    expect(CIRCLE_MAX_DELTA).toBe(0.05);
  });
});
