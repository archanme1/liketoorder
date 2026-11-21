import { memo, useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';
import Animated from 'react-native-reanimated';

import { CuisineGlyph } from '@/features/cuisines/components/CuisineLabel';
import type { Cuisine } from '@/features/cuisines/schema';
import { useTheme } from '@/theme/useTheme';

import { usePromotedFloat } from '../hooks/usePromotedFloat';
import { useTracksViewChanges } from '../hooks/useTracksViewChanges';
import type { Pin } from '../schema';

import { AdBadge, sponsoredLabel } from './AdBadge';
import { markerLabel } from './FlagMarker';

type PromotedMarkerProps = {
  pin: Pin;
  /** Undefined while the catalog loads or for an unknown code: a neutral icon is shown. */
  cuisine: Cuisine | undefined;
  selected: boolean;
  onSelect: (pin: Pin) => void;
  /** Spoken name without the suffix. Defaults to "<name>, <cuisine> cuisine" (Homemade says more). */
  accessibilityLabel?: string;
};

// The larger promoted marker (spec 16): a pill about 1.3 times the flag pill inside the ad ring,
// with the "Ad" badge. It pops in once and then floats; with Reduce Motion it is the same marker,
// still. Only these markers (at most 8, promotedLayout) keep tracksViewChanges on while they move;
// still, they stop re-drawing after their first draw like every other marker. The box is
// size.promotedMarker square, so the float never clips and the touch target is above 44 pt.
function PromotedMarkerBase({
  pin,
  cuisine,
  selected,
  onSelect,
  accessibilityLabel,
}: PromotedMarkerProps) {
  const { colors, radius, size, stroke, space } = useTheme();
  const { animatedStyle, animating } = usePromotedFloat();
  const settling = useTracksViewChanges(`${cuisine?.code ?? ''}|${selected}|${animating}`);
  const coordinate = useMemo(() => ({ latitude: pin.lat, longitude: pin.lng }), [pin.lat, pin.lng]);
  const handlePress = useCallback(() => onSelect(pin), [onSelect, pin]);

  return (
    <Marker
      coordinate={coordinate}
      onPress={handlePress}
      tracksViewChanges={animating || settling}
      // A marker press must not also reach the map's onPress (it would close the sheet).
      stopPropagation
      accessible
      accessibilityRole="button"
      accessibilityLabel={sponsoredLabel(accessibilityLabel ?? markerLabel(pin.name, cuisine))}
      // Above every organic flag (1, selected 2).
      zIndex={selected ? 4 : 3}
    >
      <View
        testID="promoted-hit"
        style={[styles.center, { width: size.promotedMarker, height: size.promotedMarker }]}
      >
        <Animated.View testID="promoted-float" style={animatedStyle}>
          <View
            testID="promoted-ring"
            style={{
              borderRadius: radius.pill,
              borderWidth: stroke.adRing,
              borderColor: colors.adRing,
            }}
          >
            <View
              testID="promoted-pill"
              style={[
                styles.center,
                {
                  minWidth: size.promotedFlagWidth + space.sm,
                  height: size.promotedFlagHeight + space.sm,
                  paddingHorizontal: space.xs,
                  borderRadius: radius.pill,
                  backgroundColor: colors.surface,
                  // Selected = a darker, thicker inner border (not a bigger marker).
                  borderColor: selected ? colors.text : colors.border,
                  borderWidth: selected ? stroke.selected : StyleSheet.hairlineWidth,
                },
              ]}
            >
              <CuisineGlyph cuisine={cuisine} size={size.promotedFlagHeight - space.xs} />
            </View>
          </View>
          <AdBadge style={{ top: -space.xs, right: 0 }} />
        </Animated.View>
      </View>
    </Marker>
  );
}

export const PromotedMarker = memo(PromotedMarkerBase);

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
