import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { maxFontMultiplier } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { CUISINE_LEGEND, GLOBE, LEGEND_SEPARATOR, type CuisineGlyphKind } from '../activity';

// One Cuisine view square's glyph (spec 15 Decision 3): a country's flag emoji, a neutral
// cuisine's icon, or the globe. Fixed at gridGlyph with no font scaling, so it fits the 14 pt
// square at any text size. Decorative: the square's label says the cuisine (spec 04 display rule).
export function CuisineDayGlyph({ glyph }: { glyph: CuisineGlyphKind }) {
  const { colors, size } = useTheme();
  if (glyph.kind === 'icon') {
    return (
      <Ionicons
        name={glyph.icon}
        size={size.gridGlyph}
        color={colors.textMuted}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    );
  }
  return (
    <Text
      allowFontScaling={false}
      style={{ fontSize: size.gridGlyph }}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {glyph.kind === 'flag' ? glyph.flag : GLOBE}
    </Text>
  );
}

// The Cuisine view's legend, in place of the intensity one: one spoken element, its words and
// glyphs hidden from screen readers.
export function CuisineLegend() {
  const { space } = useTheme();
  return (
    <View accessible accessibilityLabel={CUISINE_LEGEND.spoken}>
      <View
        testID="cuisine-legend-samples"
        style={[styles.row, { gap: space.xs }]}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <Text variant="caption" color="textMuted" maxFontSizeMultiplier={maxFontMultiplier}>
          {CUISINE_LEGEND.one}
        </Text>
        <Text variant="caption" color="textMuted" maxFontSizeMultiplier={maxFontMultiplier}>
          {LEGEND_SEPARATOR}
        </Text>
        <Text variant="caption" maxFontSizeMultiplier={maxFontMultiplier}>
          {GLOBE}
        </Text>
        <Text variant="caption" color="textMuted" maxFontSizeMultiplier={maxFontMultiplier}>
          {CUISINE_LEGEND.more}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' },
});
