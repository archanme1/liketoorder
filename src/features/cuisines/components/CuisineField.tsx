import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Button, Screen, Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { useCuisine } from '../hooks/useCuisines';

import { CuisineLabel } from './CuisineLabel';
import { CuisinePicker } from './CuisinePicker';

type CuisineFieldProps = {
  value: string | null;
  onChange: (code: string) => void;
  /** Shown under the field with a ⚠ prefix, so it never relies on color alone. */
  error?: string;
  label?: string;
};

// A form field that shows the chosen cuisine and opens the searchable picker full screen.
// The 200-row list is virtualised in its own modal rather than nested in the form's ScrollView.
export function CuisineField({ value, onChange, error, label = 'Cuisine' }: CuisineFieldProps) {
  const { colors, space, radius, size, type, weight, opacity } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = useCuisine(value);
  const current = value ? (selected.data?.name ?? 'Selected') : 'Not chosen';
  // Stable, so the picker's memoised rows don't all re-render when this field does.
  const select = useCallback(
    (code: string) => {
      onChange(code);
      setOpen(false);
    },
    [onChange],
  );

  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ fontWeight: weight.semibold }}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current}`}
        accessibilityHint={error ?? 'Opens the cuisine list'}
        style={({ pressed }) => [
          styles.field,
          {
            minHeight: size.touch,
            gap: space.sm,
            paddingHorizontal: space.md,
            borderRadius: radius.md,
            borderColor: error ? colors.danger : colors.border,
            backgroundColor: colors.surface,
            opacity: pressed ? opacity.pressed : 1,
          },
        ]}
      >
        <View style={styles.flex} importantForAccessibility="no-hide-descendants">
          {value ? <CuisineLabel code={value} /> : <Text color="textMuted">Choose a cuisine</Text>}
        </View>
        <Ionicons
          name="chevron-forward"
          size={type.bodyLg}
          color={colors.textMuted}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </Pressable>
      {error ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
          {`⚠ ${error}`}
        </Text>
      ) : null}

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <Screen style={{ gap: space.md }}>
          <View accessibilityViewIsModal style={[styles.flex, { gap: space.md }]}>
            <View style={styles.header}>
              <Text variant="title" accessibilityRole="header" style={styles.flex}>
                Choose a cuisine
              </Text>
              <Button
                title="Close"
                variant="ghost"
                accessibilityLabel="Close cuisine list"
                onPress={() => setOpen(false)}
              />
            </View>
            <CuisinePicker value={value} onChange={select} />
          </View>
        </Screen>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  header: { flexDirection: 'row', alignItems: 'center' },
});
