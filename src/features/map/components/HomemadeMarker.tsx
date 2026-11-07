import { memo, useMemo } from 'react';
import { Circle } from 'react-native-maps';

import { useTheme } from '@/theme/useTheme';

import { CIRCLE_RADIUS_M } from '../region';

import type { Cuisine } from '@/features/cuisines/schema';
import type { Pin } from '../schema';

import { FlagMarker } from './FlagMarker';

type HomemadeMarkerProps = {
  pin: Pin;
  cuisine: Cuisine | undefined;
  selected: boolean;
  onSelect: (pin: Pin) => void;
  /** True while the map is zoomed in enough to draw the circle. */
  zoomedIn: boolean;
};

export function homemadeMarkerLabel(name: string, cuisine: Cuisine | undefined): string {
  const cuisinePart = cuisine ? `, ${cuisine.name} cuisine` : '';
  return `${name}${cuisinePart}, homemade, approximate area`;
}

// A flag at the server's public point, inside a translucent 500 m circle meaning "somewhere in this
// area". The circle's centre is that same point straight from the server: the app never computes,
// rounds or offsets a homemade point. The circle is decoration: it is not tappable (react-native-maps
// gives Circle no press), so a tap inside it is a plain map tap; the flag opens the sheet.
function HomemadeMarkerBase({ pin, cuisine, selected, onSelect, zoomedIn }: HomemadeMarkerProps) {
  const { mapArea } = useTheme();
  const center = useMemo(() => ({ latitude: pin.lat, longitude: pin.lng }), [pin.lat, pin.lng]);
  return (
    <>
      {zoomedIn ? (
        <Circle
          center={center}
          radius={CIRCLE_RADIUS_M}
          fillColor={mapArea.fill}
          strokeColor={mapArea.stroke}
          strokeWidth={mapArea.strokeWidth}
          // Under every flag, so an overlapping circle can never sit on top of a flag.
          zIndex={0}
        />
      ) : null}
      <FlagMarker
        pin={pin}
        cuisine={cuisine}
        selected={selected}
        onSelect={onSelect}
        accessibilityLabel={homemadeMarkerLabel(pin.name, cuisine)}
      />
    </>
  );
}

export const HomemadeMarker = memo(HomemadeMarkerBase);
