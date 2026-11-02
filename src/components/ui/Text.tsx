import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import type { Theme } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

type TextProps = RNTextProps & {
  variant?: keyof Theme['type'];
  color?: keyof Theme['colors'];
};

export function Text({ variant = 'body', color = 'text', style, ...rest }: TextProps) {
  const { colors, type, weight } = useTheme();
  const isHeading = variant === 'title' || variant === 'h1';
  return (
    <RNText
      style={[
        {
          color: colors[color],
          fontSize: type[variant],
          fontWeight: isHeading ? weight.bold : weight.regular,
        },
        style,
      ]}
      {...rest}
    />
  );
}
