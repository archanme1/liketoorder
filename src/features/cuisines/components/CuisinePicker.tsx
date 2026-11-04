import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View, type ListRenderItem } from 'react-native';

import { EmptyState, ErrorState, Skeleton, Text, TextField } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import type { CuisineAppError } from '../api';
import { useCuisines } from '../hooks/useCuisines';
import type { Cuisine } from '../schema';
import { filterCuisines } from '../search';

import { CuisineGlyph } from './CuisineLabel';

const SKELETON_ROWS = 6;

type CuisinePickerProps = {
  value: string | null;
  onChange: (code: string) => void;
};

function cuisineErrorMessage(code: CuisineAppError['code']): string {
  return code === 'network'
    ? 'Can’t load cuisines. Check your connection and try again.'
    : 'Couldn’t load cuisines. Please try again.';
}

/** Searchable single-select list of the shared cuisine catalog. Search ignores case and accents. */
export function CuisinePicker({ value, onChange }: CuisinePickerProps) {
  const { space, size } = useTheme();
  const cuisines = useCuisines();
  const [query, setQuery] = useState('');
  const filtered = useMemo(
    () => (cuisines.data ? filterCuisines(cuisines.data, query) : []),
    [cuisines.data, query],
  );
  // Rows are memoised and get only stable props, so typing in the search box or changing the
  // selection re-renders just the rows whose `checked` changed.
  const renderItem = useCallback<ListRenderItem<Cuisine>>(
    ({ item }) => <CuisineRow cuisine={item} checked={item.code === value} onSelect={onChange} />,
    [value, onChange],
  );

  let body;
  if (cuisines.isPending) {
    body = (
      <View accessible accessibilityLabel="Loading cuisines" style={{ gap: space.sm }}>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <Skeleton key={index} height={size.touch} />
        ))}
      </View>
    );
  } else if (cuisines.isError && cuisines.data === undefined) {
    body = (
      <ErrorState
        message={cuisineErrorMessage(cuisines.error.code)}
        onRetry={() => void cuisines.refetch()}
        retrying={cuisines.isRefetching}
      />
    );
  } else {
    body = (
      <FlatList
        data={filtered}
        extraData={value}
        keyExtractor={keyExtractor}
        keyboardShouldPersistTaps="handled"
        accessibilityRole="radiogroup"
        renderItem={renderItem}
        ListEmptyComponent={<EmptyState message="No cuisines match" />}
        contentContainerStyle={{ gap: space.xs, paddingBottom: space.xl }}
      />
    );
  }

  return (
    <View style={[styles.flex, { gap: space.md }]}>
      <TextField
        label="Search cuisines"
        value={query}
        onChangeText={setQuery}
        placeholder="e.g. Italy"
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
      />
      {body}
    </View>
  );
}

function keyExtractor(cuisine: Cuisine): string {
  return cuisine.code;
}

type CuisineRowProps = { cuisine: Cuisine; checked: boolean; onSelect: (code: string) => void };

// Selection is shown by a check icon and a thicker border, not by color alone.
const CuisineRow = memo(function CuisineRow({ cuisine, checked, onSelect }: CuisineRowProps) {
  const { colors, space, radius, size, type, weight, opacity, stroke } = useTheme();
  return (
    <Pressable
      onPress={() => onSelect(cuisine.code)}
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      accessibilityLabel={cuisine.name}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: size.touch,
          gap: space.md,
          paddingHorizontal: space.md,
          borderRadius: radius.md,
          borderWidth: checked ? stroke.selected : StyleSheet.hairlineWidth,
          borderColor: checked ? colors.primary : colors.border,
          backgroundColor: colors.surface,
          opacity: pressed ? opacity.pressed : 1,
        },
      ]}
    >
      <CuisineGlyph cuisine={cuisine} size={type.bodyLg} />
      <Text style={[styles.flex, checked && { fontWeight: weight.semibold }]}>{cuisine.name}</Text>
      <Ionicons
        name={checked ? 'checkmark-circle' : 'ellipse-outline'}
        size={type.title}
        color={checked ? colors.primary : colors.textMuted}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
});
