import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/ui';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { maxFontMultiplier } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { LAUNCH_AREA } from '../launchArea';
import { CHANGE_AREA_TITLE, LAST_MAP_AREA_LABEL, USE_MY_LOCATION_LABEL } from '../messages';
import type { AreaSource } from '../offersArea';

export type AreaOption = 'me' | AreaSource;

export const LAUNCH_AREA_LABEL = `${LAUNCH_AREA.name} (launch area)`;

type ChangeAreaProps = {
  visible: boolean;
  /** What the list uses now. */
  current: AreaOption;
  /** Offer "Area last viewed on the map" (only when there is a usable saved view). */
  hasLastMap: boolean;
  onChoose: (option: AreaOption) => void;
  onClose: () => void;
};

// Spec 16 Change area: a panel from the bottom with one radio group. Choosing applies at once and
// closes it. The choice is kept by the screen for this visit only, never stored.
export function ChangeArea({ visible, current, hasLastMap, onChoose, onClose }: ChangeAreaProps) {
  const { colors, space, radius, size, stroke, type, weight, opacity, scrim } = useTheme();
  const insets = useSafeAreaInsets();
  // Reduce Motion: the panel appears without sliding, like the Filters panel.
  const reduceMotion = useReduceMotion();
  const options: { value: AreaOption; label: string }[] = [
    { value: 'me', label: USE_MY_LOCATION_LABEL },
    ...(hasLastMap ? [{ value: 'last_map' as const, label: LAST_MAP_AREA_LABEL }] : []),
    { value: 'launch', label: LAUNCH_AREA_LABEL },
  ];
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, { backgroundColor: scrim }]}>
        <View
          accessibilityViewIsModal
          testID="change-area"
          style={{
            gap: space.md,
            padding: space.lg,
            paddingBottom: space.lg + insets.bottom,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            backgroundColor: colors.bg,
          }}
        >
          <View style={styles.header}>
            <Text variant="title" accessibilityRole="header" style={styles.title}>
              {CHANGE_AREA_TITLE}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed }) => [
                styles.close,
                { width: size.touch, height: size.touch, opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              <Ionicons name="close" size={size.tabIcon} color={colors.text} />
            </Pressable>
          </View>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={CHANGE_AREA_TITLE}
            style={{ gap: space.sm }}
          >
            {options.map((option) => {
              const selected = option.value === current;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => onChoose(option.value)}
                  accessibilityRole="radio"
                  accessibilityLabel={selected ? `${option.label}, selected` : option.label}
                  accessibilityState={{ selected }}
                  style={[
                    styles.option,
                    {
                      minHeight: size.touch,
                      gap: space.sm,
                      paddingHorizontal: space.lg,
                      paddingVertical: space.sm,
                      borderRadius: radius.md,
                      borderWidth: selected ? stroke.selected : StyleSheet.hairlineWidth,
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: colors.surface,
                    },
                  ]}
                >
                  <Ionicons
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={type.bodyLg}
                    color={selected ? colors.primary : colors.textMuted}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  />
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
          <Button title="Cancel" onPress={onClose} variant="secondary" />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  header: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1 },
  close: { alignItems: 'center', justifyContent: 'center' },
  option: { flexDirection: 'row', alignItems: 'center' },
});
