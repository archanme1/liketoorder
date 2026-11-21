import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { maxFontMultiplier } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import {
  ALL_LABEL,
  ANY_TABLES_LABEL,
  CATEGORY_LABELS,
  FILTER_GROUP_LABELS,
  OFFER_DISTANCE_LABELS,
  OFFER_TYPE_FILTER_LABELS,
  TAKES_TABLES_LABEL,
} from '../messages';
import {
  OFFER_DISTANCES,
  OFFER_TYPES,
  PROMOTION_CATEGORIES,
  type OfferFilters as Filters,
} from '../schema';

type Option<T> = { value: T; label: string };

type ChipGroupProps<T> = {
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
};

// One radio group of chips, the spec 11c pattern: the selected chip says so in words ("About 15 km,
// selected"), shows a check mark and bold text, never colour alone. Each chip is at least 44 pt and
// the chips wrap at large text sizes.
function ChipGroup<T extends string | number | boolean | null>({
  label,
  options,
  value,
  onChange,
}: ChipGroupProps<T>) {
  const { colors, space, radius, size, stroke, type, weight } = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="caption" color="textMuted" accessible={false} importantForAccessibility="no">
        {label}
      </Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={[styles.group, { gap: space.sm }]}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              onPress={() => onChange(option.value)}
              accessibilityRole="radio"
              accessibilityLabel={selected ? `${option.label}, selected` : option.label}
              accessibilityState={{ selected }}
              style={[
                styles.option,
                {
                  minHeight: size.touch,
                  gap: space.xs,
                  paddingHorizontal: space.lg,
                  paddingVertical: space.sm,
                  borderRadius: radius.pill,
                  borderWidth: selected ? stroke.selected : StyleSheet.hairlineWidth,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.surface : undefined,
                },
              ]}
            >
              {selected ? (
                <Ionicons
                  name="checkmark"
                  size={type.bodyLg}
                  color={colors.primary}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
              ) : null}
              <Text
                maxFontSizeMultiplier={maxFontMultiplier}
                style={selected ? { fontWeight: weight.semibold } : undefined}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const CATEGORY_OPTIONS = [
  { value: null, label: ALL_LABEL },
  ...PROMOTION_CATEGORIES.map((value) => ({ value, label: CATEGORY_LABELS[value] })),
] as const;
const TYPE_OPTIONS = [
  { value: null, label: ALL_LABEL },
  ...OFFER_TYPES.map((value) => ({ value, label: OFFER_TYPE_FILTER_LABELS[value] })),
] as const;
const DISTANCE_OPTIONS = OFFER_DISTANCES.map((value) => ({
  value,
  label: OFFER_DISTANCE_LABELS[value],
}));
const TABLE_OPTIONS = [
  { value: false, label: ANY_TABLES_LABEL },
  { value: true, label: TAKES_TABLES_LABEL },
] as const;

type OfferFiltersProps = {
  value: Filters;
  onChange: (value: Filters) => void;
};

/** Category, type, distance and table requests (spec 16): four radio groups. No cuisine filter. */
export function OfferFilters({ value, onChange }: OfferFiltersProps) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.md }}>
      <ChipGroup
        label={FILTER_GROUP_LABELS.category}
        options={CATEGORY_OPTIONS}
        value={value.category}
        onChange={(category) => onChange({ ...value, category })}
      />
      <ChipGroup
        label={FILTER_GROUP_LABELS.type}
        options={TYPE_OPTIONS}
        value={value.type}
        onChange={(type) => onChange({ ...value, type })}
      />
      <ChipGroup
        label={FILTER_GROUP_LABELS.distance}
        options={DISTANCE_OPTIONS}
        value={value.distanceKm}
        onChange={(distanceKm) => onChange({ ...value, distanceKm })}
      />
      <ChipGroup
        label={FILTER_GROUP_LABELS.tables}
        options={TABLE_OPTIONS}
        value={value.tables}
        onChange={(tables) => onChange({ ...value, tables })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', flexWrap: 'wrap' },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
