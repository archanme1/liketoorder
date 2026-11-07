import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { HOMEMADE_DISCLAIMER_BODY, HOMEMADE_DISCLAIMER_TITLE } from '../homemadeText';

// A labelled box, not a footnote: it sits at the top of the sheet body so it is readable at the
// half snap without scrolling. It grows with the text size and is never clipped or truncated. An
// icon and the words carry the meaning, never colour alone.
export function HomemadeDisclaimer() {
  const { colors, space, radius, size } = useTheme();
  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${HOMEMADE_DISCLAIMER_TITLE}. ${HOMEMADE_DISCLAIMER_BODY}`}
      testID="homemade-disclaimer"
      style={[
        styles.box,
        {
          gap: space.md,
          padding: space.md,
          borderRadius: radius.md,
          borderColor: colors.warning,
          backgroundColor: colors.surfaceAlt,
        },
      ]}
    >
      <Ionicons name="alert-circle-outline" size={size.tabIcon} color={colors.warning} />
      <View style={styles.text}>
        <Text variant="bodyLg" accessibilityRole="header">
          {HOMEMADE_DISCLAIMER_TITLE}
        </Text>
        <Text>{HOMEMADE_DISCLAIMER_BODY}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'flex-start', borderWidth: StyleSheet.hairlineWidth },
  text: { flex: 1 },
});
