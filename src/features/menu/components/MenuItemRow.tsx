import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { Text } from '@/components/ui';
import { PhotoTile } from '@/features/media/components/PhotoTile';
import { useTheme } from '@/theme/useTheme';

import type { MoveDirection } from '../api';
import { photoNames } from '../photos';
import { formatPrice } from '../price';
import type { MenuItem } from '../schema';

type MenuItemRowProps = {
  item: MenuItem;
  /** 1-based position in the list, and the list length. */
  index: number;
  count: number;
  currency: { code: string; minorUnits: number } | null;
  locale: string;
  photo?: { path: string; uri: string | null | undefined };
  onExpired: (path: string) => void;
  onEdit: (item: MenuItem) => void;
  onMove: (item: MenuItem, direction: MoveDirection) => void;
  onToggleAvailable: (item: MenuItem, isAvailable: boolean) => void;
};

// One menu item. Keyed by item id in the list, so after a move this same row (and the focused
// move button) re-renders at its new place instead of being recreated.
export const MenuItemRow = memo(function MenuItemRow({
  item,
  index,
  count,
  currency,
  locale,
  photo,
  onExpired,
  onEdit,
  onMove,
  onToggleAvailable,
}: MenuItemRowProps) {
  const { colors, space, radius, size, type, weight, opacity } = useTheme();
  const price =
    item.price_minor !== null && currency
      ? formatPrice(item.price_minor, currency.code, currency.minorUnits, locale)
      : null;
  const isFirst = index === 1;
  const isLast = index === count;

  const summary = [item.name, price, item.is_available ? null : 'Unavailable']
    .filter(Boolean)
    .join(', ');

  return (
    <View
      style={[
        styles.row,
        {
          gap: space.sm,
          padding: space.sm,
          borderRadius: radius.md,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        },
      ]}
    >
      <Pressable
        onPress={() => onEdit(item)}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${summary}`}
        style={({ pressed }) => [
          styles.main,
          { gap: space.sm, minHeight: size.touch, opacity: pressed ? opacity.pressed : 1 },
        ]}
      >
        {photo ? (
          <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <PhotoTile
              path={photo.path}
              uri={photo.uri}
              accessibilityLabel={photoNames.item(item.name)}
              onExpired={onExpired}
              size={size.touch}
            />
          </View>
        ) : null}
        <View style={[styles.flex, { gap: space.xs }]}>
          <Text style={{ fontWeight: weight.semibold }} numberOfLines={2}>
            {item.name}
          </Text>
          {price ? <Text color="textMuted">{price}</Text> : null}
          {item.is_available ? null : (
            <View style={styles.tagRow}>
              <Ionicons name="eye-off" size={type.caption} color={colors.textMuted} />
              <Text variant="caption" color="textMuted" style={{ marginLeft: space.xs }}>
                Unavailable
              </Text>
            </View>
          )}
        </View>
      </Pressable>
      <View style={[styles.controls, { gap: space.xs }]}>
        <MoveButton
          direction="up"
          label={`Move ${item.name} up`}
          disabled={isFirst}
          onPress={() => onMove(item, 'up')}
        />
        <MoveButton
          direction="down"
          label={`Move ${item.name} down`}
          disabled={isLast}
          onPress={() => onMove(item, 'down')}
        />
        <Switch
          value={item.is_available}
          onValueChange={(value) => onToggleAvailable(item, value)}
          accessibilityRole="switch"
          accessibilityLabel={`${item.name} available`}
          accessibilityState={{ checked: item.is_available }}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.surface}
          ios_backgroundColor={colors.border}
        />
      </View>
    </View>
  );
});

function MoveButton({
  direction,
  label,
  disabled,
  onPress,
}: {
  direction: MoveDirection;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors, size, type, radius, opacity } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.iconButton,
        {
          width: size.touch,
          height: size.touch,
          borderRadius: radius.md,
          opacity: disabled ? opacity.disabled : pressed ? opacity.pressed : 1,
        },
      ]}
    >
      <Ionicons
        name={direction === 'up' ? 'arrow-up' : 'arrow-down'}
        size={type.title}
        color={colors.primary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center' },
  tagRow: { flexDirection: 'row', alignItems: 'center' },
  iconButton: { alignItems: 'center', justifyContent: 'center' },
});
