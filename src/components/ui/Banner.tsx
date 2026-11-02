import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/useTheme';

import { Text } from './Text';

type BannerTone = 'error' | 'success' | 'info';

type BannerProps = {
  message: string;
  tone?: BannerTone;
};

// Prefix carries the meaning so the banner never relies on color alone.
const prefix: Record<BannerTone, string> = { error: '⚠', success: '✓', info: 'ℹ' };

export function Banner({ message, tone = 'error' }: BannerProps) {
  const { colors, space, radius } = useTheme();
  const accent = { error: colors.danger, success: colors.success, info: colors.info }[tone];

  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.root,
        {
          gap: space.sm,
          padding: space.md,
          borderRadius: radius.md,
          borderColor: accent,
          backgroundColor: colors.surface,
        },
      ]}
    >
      <Text style={{ color: accent }}>{prefix[tone]}</Text>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1 },
  message: { flex: 1 },
});
