import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View, type ListRenderItem } from 'react-native';

import { Button, EmptyState, ErrorState, Screen, Skeleton, Text, TextField } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { useCurrencies } from '../hooks/useCurrencies';
import { menuErrorMessage } from '../messages';
import type { Currency } from '../schema';

const SKELETON_ROWS = 6;

/** "Canadian dollar (CAD)" for display; the picker's rows read "Canadian dollar, CAD". */
export function currencyLabel(currency: Currency): string {
  return `${currency.name} (${currency.code})`;
}

function normalise(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

type CurrencyListProps = {
  value: string | null;
  onChange: (code: string) => void;
};

/** Searchable single-select list of ISO 4217 currencies (by name or code). */
export function CurrencyList({ value, onChange }: CurrencyListProps) {
  const { space, size } = useTheme();
  const currencies = useCurrencies();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const list = currencies.data ?? [];
    const q = normalise(query);
    if (!q) return list;
    return list.filter(
      (currency) => normalise(currency.name).includes(q) || currency.code.toLowerCase().includes(q),
    );
  }, [currencies.data, query]);

  const renderItem = useCallback<ListRenderItem<Currency>>(
    ({ item }) => <CurrencyRow currency={item} checked={item.code === value} onSelect={onChange} />,
    [value, onChange],
  );

  let body;
  if (currencies.isPending) {
    body = (
      <View accessible accessibilityLabel="Loading currencies" style={{ gap: space.sm }}>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <Skeleton key={index} height={size.touch} />
        ))}
      </View>
    );
  } else if (currencies.isError && currencies.data === undefined) {
    body = (
      <ErrorState
        message={menuErrorMessage(currencies.error.code)}
        onRetry={() => void currencies.refetch()}
        retrying={currencies.isRefetching}
      />
    );
  } else {
    body = (
      <FlatList
        data={filtered}
        extraData={value}
        keyExtractor={(currency) => currency.code}
        keyboardShouldPersistTaps="handled"
        accessibilityRole="radiogroup"
        renderItem={renderItem}
        ListEmptyComponent={<EmptyState message="No currencies match" />}
        contentContainerStyle={{ gap: space.xs, paddingBottom: space.xl }}
      />
    );
  }

  return (
    <View style={[styles.flex, { gap: space.md }]}>
      <TextField
        label="Search currencies"
        value={query}
        onChangeText={setQuery}
        placeholder="e.g. dollar or CAD"
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
      />
      {body}
    </View>
  );
}

type CurrencyRowProps = { currency: Currency; checked: boolean; onSelect: (code: string) => void };

// Selection is shown by a check icon and a thicker border, not by color alone.
const CurrencyRow = memo(function CurrencyRow({ currency, checked, onSelect }: CurrencyRowProps) {
  const { colors, space, radius, size, type, weight, opacity, stroke } = useTheme();
  return (
    <Pressable
      onPress={() => onSelect(currency.code)}
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      accessibilityLabel={`${currency.name}, ${currency.code}`}
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
      <Text style={[styles.flex, checked && { fontWeight: weight.semibold }]}>{currency.name}</Text>
      <Text color="textMuted">{currency.code}</Text>
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

type CurrencyPickerProps = {
  visible: boolean;
  /** The current or suggested currency (pre-selected), or null. */
  value: string | null;
  onSelect: (code: string) => void;
  onClose: () => void;
};

/** Full-screen modal with the searchable currency list (like the cuisine picker). */
export function CurrencyPicker({ visible, value, onSelect, onClose }: CurrencyPickerProps) {
  const { space } = useTheme();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <Screen style={{ gap: space.md }}>
        <View accessibilityViewIsModal style={[styles.flex, { gap: space.md }]}>
          <View style={styles.header}>
            <Text variant="title" accessibilityRole="header" style={styles.flex}>
              Choose a currency
            </Text>
            <Button
              title="Close"
              variant="ghost"
              accessibilityLabel="Close currency list"
              onPress={onClose}
            />
          </View>
          <CurrencyList value={value} onChange={onSelect} />
        </View>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center' },
});
