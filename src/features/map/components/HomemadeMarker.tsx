import { memo, useMemo } from 'react';
import { Circle } from 'react-native-maps';

import { useTheme } from '@/theme/useTheme';

import { CIRCLE_RADIUS_M } from '../region';

import type { Cuisine } from '@/features/cuisines/schema';
import type { PromotionLook } from '../promotedLayout';
import type { Pin } from '../schema';

import { FlagMarker } from './FlagMarker';
import { PromotedMarker } from './PromotedMarker';

type HomemadeMarkerProps = {
  pin: Pin;
  cuisine: Cuisine | undefined;
  selected: boolean;
  onSelect: (pin: Pin) => void;
  /** True while the map is zoomed in enough to draw the circle. */
  zoomedIn: boolean;
  /** Spec 16: 'large' draws the larger promoted marker, 'ring' the ringed flag. Default 'none'. */
  promotion?: PromotionLook;
};

export function homemadeMarkerLabel(name: string, cuisine: Cuisine | undefined): string {
  const cuisinePart = cuisine ? `, ${cuisine.name} cuisine` : '';
  return `${name}${cuisinePart}, homemade, approximate area`;
}

// A flag at the server's public point, inside a translucent 500 m circle meaning "somewhere in this
// area". The circle's centre is that same point straight from the server: the app never computes,
// rounds or offsets a homemade point. The circle is decoration: it is not tappable (react-native-maps
// gives Circle no press), so a tap inside it is a plain map tap; the flag opens the sheet.
// A promoted cook (spec 16) keeps exactly the same circle: same 500 m, same centre, same colours,
// only when zoomed in. Only the flag changes; the large one's float is a 4 pt move of its picture
// on screen, never a different map position, so nothing hints at where the home is.
function HomemadeMarkerBase({
  pin,
  cuisine,
  selected,
  onSelect,
  zoomedIn,
  promotion = 'none',
}: HomemadeMarkerProps) {
  const { mapArea } = useTheme();
  const center = useMemo(() => ({ latitude: pin.lat, longitude: pin.lng }), [pin.lat, pin.lng]);
  const label = homemadeMarkerLabel(pin.name, cuisine);
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
      {promotion === 'large' ? (
        <PromotedMarker
          pin={pin}
          cuisine={cuisine}
          selected={selected}
          onSelect={onSelect}
          accessibilityLabel={label}
        />
      ) : (
        <FlagMarker
          pin={pin}
          cuisine={cuisine}
          selected={selected}
          onSelect={onSelect}
          accessibilityLabel={label}
          promotion={promotion}
        />
      )}
    </>
  );
}

export const HomemadeMarker = memo(HomemadeMarkerBase);
