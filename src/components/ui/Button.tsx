import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { useTheme } from '@/theme/useTheme';

import { Text } from './Text';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  /** Defaults to `title`. Set when the visible text alone is not descriptive enough. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps) {
  const { colors, space, radius, size, weight, opacity } = useTheme();
  const inactive = disabled || loading;

  const background = {
    primary: colors.primary,
    secondary: colors.surface,
    ghost: 'transparent',
  }[variant];
  const foreground = variant === 'primary' ? 'primaryText' : 'primary';

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: size.touch,
          paddingHorizontal: space.lg,
          borderRadius: radius.md,
          backgroundColor: background,
          borderColor: variant === 'secondary' ? colors.border : 'transparent',
          opacity: inactive ? opacity.disabled : pressed ? opacity.pressed : 1,
        },
      ]}
    >
      {/* The title stays laid out while loading so the button keeps its width. */}
      <Text
        variant="bodyLg"
        color={foreground}
        style={{ fontWeight: weight.semibold, opacity: loading ? 0 : 1 }}
      >
        {title}
      </Text>
      {loading ? (
        <ActivityIndicator color={colors[foreground]} style={StyleSheet.absoluteFill} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
