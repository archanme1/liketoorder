import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import {
  HOMEMADE_DISCLAIMER_BODY,
  HOMEMADE_DISCLAIMER_HINT,
  HOMEMADE_DISCLAIMER_LABEL,
  HOMEMADE_DISCLAIMER_TITLE,
} from '../homemadeText';

// A small disclosure row: the title and an info icon, and the full note opens inline when the row
// is tapped. Collapsed at every text size. The whole row is the button (at least 44 pt tall, and it
// grows with the text size, so nothing is clipped or truncated). A screen reader hears the whole
// warning on the collapsed row, and the expanded state is exposed. The icon and the words carry
// the meaning, never colour alone. Placeholder wording until spec 18 (see homemadeText.ts).
export function HomemadeDisclaimer() {
  const { colors, space, radius, size } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <Pressable
      onPress={() => setOpen((value) => !value)}
      accessibilityRole="button"
      accessibilityLabel={HOMEMADE_DISCLAIMER_LABEL}
      accessibilityHint={HOMEMADE_DISCLAIMER_HINT}
      accessibilityState={{ expanded: open }}
      testID="homemade-disclaimer"
      style={({ pressed }) => [
        styles.box,
        {
          minHeight: size.touch,
          gap: space.sm,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          borderRadius: radius.md,
          borderColor: colors.border,
          backgroundColor: colors.surfaceAlt,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={[styles.row, { gap: space.sm }]}>
        <Text style={styles.title}>{HOMEMADE_DISCLAIMER_TITLE}</Text>
        <Ionicons name="information-circle-outline" size={size.tabIcon} color={colors.warning} />
      </View>
      {open ? <Text>{HOMEMADE_DISCLAIMER_BODY}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1 },
});
