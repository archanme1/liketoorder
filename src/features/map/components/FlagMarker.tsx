import { memo, useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';

import { CuisineGlyph } from '@/features/cuisines/components/CuisineLabel';
import type { Cuisine } from '@/features/cuisines/schema';
import { useTheme } from '@/theme/useTheme';

import { useTracksViewChanges } from '../hooks/useTracksViewChanges';
import type { Pin } from '../schema';

import { AdBadge, sponsoredLabel } from './AdBadge';

type FlagMarkerProps = {
  pin: Pin;
  /** Undefined while the catalog loads or for an unknown code: a neutral icon is shown. */
  cuisine: Cuisine | undefined;
  selected: boolean;
  onSelect: (pin: Pin) => void;
  /** Spoken name. Defaults to "<name>, <cuisine> cuisine" (the Homemade tab says more). */
  accessibilityLabel?: string;
  /**
   * 'ring': a promoted place not drawn large (spec 16): the same size pill inside the ad ring, with
   * the "Ad" badge and ", sponsored" spoken. Large ones are PromotedMarker. Default 'none'.
   */
  promotion?: 'none' | 'ring';
};

export function markerLabel(name: string, cuisine: Cuisine | undefined): string {
  return cuisine ? `${name}, ${cuisine.name} cuisine` : name;
}

// Flag in a rounded pill; neutral cuisines show their icon instead. The name is never carried by
// the flag alone: the accessibility label always names the restaurant and its cuisine. The
// outer box is 44 × 44 so the touch target meets the minimum even though the pill is smaller.
function FlagMarkerBase({
  pin,
  cuisine,
  selected,
  onSelect,
  accessibilityLabel,
  promotion = 'none',
}: FlagMarkerProps) {
  const { colors, radius, size, stroke, space } = useTheme();
  const ringed = promotion === 'ring';
  const tracksViewChanges = useTracksViewChanges(`${cuisine?.code ?? ''}|${selected}|${promotion}`);
  const label = accessibilityLabel ?? markerLabel(pin.name, cuisine);
  const pill = (
    <View
      testID="flag-pill"
      style={[
        styles.pill,
        {
          minWidth: size.flagWidth + space.sm,
          height: size.flagHeight + space.sm,
          paddingHorizontal: space.xs,
          borderRadius: radius.pill,
          backgroundColor: colors.surface,
          // Selected = a darker, thicker ring (not a bigger marker).
          borderColor: selected ? colors.text : colors.border,
          borderWidth: selected ? stroke.selected : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <CuisineGlyph cuisine={cuisine} size={size.flagHeight - space.xs} />
    </View>
  );
  const coordinate = useMemo(() => ({ latitude: pin.lat, longitude: pin.lng }), [pin.lat, pin.lng]);
  const handlePress = useCallback(() => onSelect(pin), [onSelect, pin]);

  return (
    <Marker
      coordinate={coordinate}
      onPress={handlePress}
      tracksViewChanges={tracksViewChanges}
      // A marker press must not also reach the map's onPress (it would close the sheet).
      stopPropagation
      accessible
      accessibilityRole="button"
      accessibilityLabel={ringed ? sponsoredLabel(label) : label}
      // Promoted ones sit above every organic flag (selected or not).
      zIndex={ringed ? (selected ? 4 : 3) : selected ? 2 : 1}
    >
      <View testID="flag-hit" style={[styles.hit, { width: size.touch, height: size.touch }]}>
        {ringed ? (
          <View
            testID="flag-ad-ring"
            style={{
              borderRadius: radius.pill,
              borderWidth: stroke.adRing,
              borderColor: colors.adRing,
            }}
          >
            {pill}
          </View>
        ) : (
          pill
        )}
        {ringed ? <AdBadge style={{ top: 0, right: 0 }} /> : null}
      </View>
    </Marker>
  );
}

export const FlagMarker = memo(FlagMarkerBase);

const styles = StyleSheet.create({
  hit: { alignItems: 'center', justifyContent: 'center' },
  pill: { alignItems: 'center', justifyContent: 'center' },
});
