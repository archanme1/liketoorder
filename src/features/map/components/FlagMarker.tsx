import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';

import { CuisineGlyph } from '@/features/cuisines/components/CuisineLabel';
import type { Cuisine } from '@/features/cuisines/schema';
import { useTheme } from '@/theme/useTheme';

import { useTracksViewChanges } from '../hooks/useTracksViewChanges';
import type { Pin } from '../schema';

type FlagMarkerProps = {
  pin: Pin;
  /** Undefined while the catalog loads or for an unknown code: a neutral icon is shown. */
  cuisine: Cuisine | undefined;
  selected: boolean;
  onSelect: (pin: Pin) => void;
};

export function markerLabel(name: string, cuisine: Cuisine | undefined): string {
  return cuisine ? `${name}, ${cuisine.name} cuisine` : name;
}

// Flag in a rounded pill; neutral cuisines show their icon instead. The name is never carried by
// the flag alone: the accessibility label always names the restaurant and its cuisine. The
// outer box is 44 × 44 so the touch target meets the minimum even though the pill is smaller.
function FlagMarkerBase({ pin, cuisine, selected, onSelect }: FlagMarkerProps) {
  const { colors, radius, size, stroke, space } = useTheme();
  const tracksViewChanges = useTracksViewChanges(`${cuisine?.code ?? ''}|${selected}`);

  return (
    <Marker
      coordinate={{ latitude: pin.lat, longitude: pin.lng }}
      onPress={() => onSelect(pin)}
      tracksViewChanges={tracksViewChanges}
      accessible
      accessibilityRole="button"
      accessibilityLabel={markerLabel(pin.name, cuisine)}
      zIndex={selected ? 2 : 1}
    >
      <View testID="flag-hit" style={[styles.hit, { width: size.touch, height: size.touch }]}>
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
      </View>
    </Marker>
  );
}

export const FlagMarker = memo(FlagMarkerBase);

const styles = StyleSheet.create({
  hit: { alignItems: 'center', justifyContent: 'center' },
  pill: { alignItems: 'center', justifyContent: 'center' },
});
