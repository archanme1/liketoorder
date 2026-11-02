import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme/useTheme';

import { Text } from './Text';

type AvatarSize = 'sm' | 'md' | 'lg';

type AvatarProps = {
  displayName?: string | null;
  username?: string | null;
  size?: AvatarSize;
};

/** Up to 2 initials from the display name ("Archan Me" → "AM"), else the username's first letter, else "?". */
export function getInitials(displayName?: string | null, username?: string | null): string {
  const words = (displayName ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    const first = Array.from(words[0])[0] ?? '';
    const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? '') : '';
    return (first + last).toUpperCase();
  }
  const fromUsername = Array.from((username ?? '').trim())[0];
  return fromUsername ? fromUsername.toUpperCase() : '?';
}

// Initials only (no photo upload in v1). Not touchable; the initials text carries the meaning.
export function Avatar({ displayName, username, size = 'md' }: AvatarProps) {
  const { colors, size: sizes, type, weight } = useTheme();
  const diameter = { sm: sizes.avatarSm, md: sizes.avatarMd, lg: sizes.avatarLg }[size];
  const fontSize = { sm: type.body, md: type.title, lg: type.h1 }[size];
  const name = displayName?.trim() || username?.trim() || 'User';

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${name}'s profile picture`}
      style={[
        styles.circle,
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          backgroundColor: colors.surfaceAlt,
          borderColor: colors.border,
        },
      ]}
    >
      <Text style={{ fontSize, fontWeight: weight.semibold }}>
        {getInitials(displayName, username)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
