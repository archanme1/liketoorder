import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';

import { Skeleton, Text } from '@/components/ui';
import type { Theme } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { useCuisine } from '../hooks/useCuisines';
import { FALLBACK_CUISINE_ICON, type Cuisine } from '../schema';

export const UNKNOWN_CUISINE = 'Unknown cuisine';

type CuisineLabelProps = {
  /** Looked up in the cached catalog. Ignored when `cuisine` is given. */
  code?: string | null;
  cuisine?: Cuisine;
  variant?: keyof Theme['type'];
};

// Spec 04 display rule: the name is always visible text; the flag or icon is decorative and
// hidden from screen readers, so VoiceOver reads "Italy", not "flag: Italy, Italy".
export function CuisineLabel({ code, cuisine, variant = 'body' }: CuisineLabelProps) {
  const lookup = useCuisine(cuisine ? undefined : code);
  const { space, type } = useTheme();
  const resolved = cuisine ?? lookup.data;

  if (!cuisine && lookup.isPending) {
    return (
      <View accessible accessibilityLabel="Loading cuisine">
        <Skeleton width={space.xxl * 3} height={type[variant]} />
      </View>
    );
  }

  const name = resolved?.name ?? UNKNOWN_CUISINE;
  return (
    <View accessible accessibilityLabel={name} style={[styles.row, { gap: space.sm }]}>
      <CuisineGlyph cuisine={resolved} size={type[variant]} />
      <Text variant={variant}>{name}</Text>
    </View>
  );
}

export function CuisineGlyph({ cuisine, size }: { cuisine: Cuisine | undefined; size: number }) {
  const { colors } = useTheme();
  if (cuisine?.kind === 'country') {
    return (
      <Text
        style={{ fontSize: size }}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {cuisine.flag}
      </Text>
    );
  }
  return (
    <Ionicons
      name={cuisine?.kind === 'neutral' ? cuisine.icon : FALLBACK_CUISINE_ICON}
      size={size}
      color={colors.textMuted}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
