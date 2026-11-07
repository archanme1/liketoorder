import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import type { Cuisine } from '@/features/cuisines/schema';
import { CuisineGlyph } from '@/features/cuisines/components/CuisineLabel';
import { useTheme } from '@/theme/useTheme';

import type { Pin } from '../schema';

import { markerLabel } from './FlagMarker';

type PlacesListProps = {
  pins: readonly Pin[];
  cuisineByCode: ReadonlyMap<string, Cuisine>;
  onSelect: (pin: Pin) => void;
};

export const PLACES_TITLE = 'Places in this area';
export const NO_PLACES_MESSAGE = 'No restaurants shown here. Zoom in or move the map.';

// The map alternative for screen-reader users: every pin currently loaded, as plain rows.
export function PlacesList({ pins, cuisineByCode, onSelect }: PlacesListProps) {
  const { colors, space, size, radius } = useTheme();
  const sorted = [...pins].sort((a, b) => a.name.localeCompare(b.name));

  if (sorted.length === 0) {
    return <Text color="textMuted">{NO_PLACES_MESSAGE}</Text>;
  }

  return (
    <View style={{ gap: space.xs }}>
      {sorted.map((pin) => {
        const cuisine = cuisineByCode.get(pin.cuisine_code);
        return (
          <Pressable
            key={pin.id}
            onPress={() => onSelect(pin)}
            accessibilityRole="button"
            accessibilityLabel={markerLabel(pin.name, cuisine)}
            style={[
              styles.row,
              {
                minHeight: size.touch,
                gap: space.md,
                paddingVertical: space.sm,
                paddingHorizontal: space.md,
                borderRadius: radius.md,
                borderColor: colors.border,
              },
            ]}
          >
            <CuisineGlyph cuisine={cuisine} size={size.tabIcon} />
            <View style={styles.text}>
              <Text numberOfLines={3}>{pin.name}</Text>
              {cuisine ? (
                <Text variant="caption" color="textMuted">
                  {cuisine.name}
                </Text>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={size.tabIcon} color={colors.textMuted} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  text: { flex: 1 },
});
