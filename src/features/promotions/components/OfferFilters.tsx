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
  DEFAULT_OFFER_FILTERS,
  OFFER_DISTANCES,
  OFFER_TYPES,
  PROMOTION_CATEGORIES,
  type OfferFilters as Filters,
} from '../schema';

/** Same filters, group by group. */
export function sameFilters(a: Filters, b: Filters): boolean {
  return (
    a.category === b.category &&
    a.type === b.type &&
    a.distanceKm === b.distanceKm &&
    a.tables === b.tables
  );
}

/**
 * How many groups differ from the defaults (Category All, Type All, About 15 km, Any). The
 * default distance is not a filter the person chose, so it never counts.
 */
export function activeFilterCount(filters: Filters): number {
  return (
    Number(filters.category !== DEFAULT_OFFER_FILTERS.category) +
    Number(filters.type !== DEFAULT_OFFER_FILTERS.type) +
    Number(filters.distanceKm !== DEFAULT_OFFER_FILTERS.distanceKm) +
    Number(filters.tables !== DEFAULT_OFFER_FILTERS.tables)
  );
}

/** The groups that differ from the defaults, in words: "Special offer, Restaurants, About 30 km". */
export function filterSummary(filters: Filters): string {
  const parts: string[] = [];
  if (filters.category !== DEFAULT_OFFER_FILTERS.category && filters.category) {
    parts.push(CATEGORY_LABELS[filters.category]);
  }
  if (filters.type !== DEFAULT_OFFER_FILTERS.type && filters.type) {
    parts.push(OFFER_TYPE_FILTER_LABELS[filters.type]);
  }
  if (filters.distanceKm !== DEFAULT_OFFER_FILTERS.distanceKm) {
    parts.push(OFFER_DISTANCE_LABELS[filters.distanceKm]);
  }
  if (filters.tables !== DEFAULT_OFFER_FILTERS.tables) parts.push(TAKES_TABLES_LABEL);
  return parts.join(', ');
}

/** "Filters" or "Filters (2)" on the button; "Filters" or "Filters, 2 applied" spoken. */
export function filtersButtonText(count: number): { title: string; label: string } {
  return count === 0
    ? { title: 'Filters', label: 'Filters' }
    : { title: `Filters (${count})`, label: `Filters, ${count} applied` };
}

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

/**
 * Category, type, distance and table requests (spec 16): four radio groups, shown inside the
 * Filters panel. No cuisine filter.
 */
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
