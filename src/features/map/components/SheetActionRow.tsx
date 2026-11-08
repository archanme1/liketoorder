import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import type { SheetAction } from '../hooks/useSheetActions';

// The sheet's action buttons, in the FIXED part of the sheet under the header and outside the
// scrolling content, so they stay on screen while the content scrolls. One or two buttons that
// wrap (each at least a thumbnail wide, none a fixed height) so large text never clips them.
// No actions, no row: nothing is reserved for a button that isn't there.
export function SheetActionRow({ actions }: { actions: readonly SheetAction[] }) {
  const { space, size } = useTheme();
  if (actions.length === 0) return null;
  return (
    <View
      testID="sheet-actions"
      style={[styles.row, { gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md }]}
    >
      {actions.map((action) => (
        <View key={action.key} style={[styles.cell, { minWidth: size.photoThumb }]}>
          <Button
            title={action.title}
            accessibilityLabel={action.accessibilityLabel}
            accessibilityHint={action.accessibilityHint}
            onPress={action.onPress}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { flexGrow: 1 },
});
