import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '@/theme/useTheme';

import { Text } from './Text';

type TextFieldProps = Omit<TextInputProps, 'style' | 'accessibilityLabel'> & {
  label: string;
  /** Shown under the field with a ⚠ prefix, so it never relies on color alone. */
  error?: string;
  /** Hint under the field when there is no error, e.g. password rules. */
  hint?: string;
};

export function TextField({ label, error, hint, secureTextEntry, ...inputProps }: TextFieldProps) {
  const { colors, space, radius, size, type, weight, opacity } = useTheme();
  const [revealed, setRevealed] = useState(false);
  const hidden = secureTextEntry && !revealed;

  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ fontWeight: weight.semibold }}>{label}</Text>
      <View
        style={[
          styles.inputRow,
          {
            minHeight: size.touch,
            borderRadius: radius.md,
            borderColor: error ? colors.danger : colors.border,
            backgroundColor: colors.surface,
          },
        ]}
      >
        <TextInput
          {...inputProps}
          secureTextEntry={hidden}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          placeholderTextColor={colors.textMuted}
          style={[
            styles.input,
            { color: colors.text, fontSize: type.body, paddingHorizontal: space.md },
          ]}
        />
        {secureTextEntry ? (
          <Pressable
            onPress={() => setRevealed((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel={
              revealed ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`
            }
            hitSlop={space.xs}
            style={({ pressed }) => [
              styles.toggle,
              {
                minHeight: size.touch,
                minWidth: size.touch,
                paddingHorizontal: space.md,
                opacity: pressed ? opacity.pressed : 1,
              },
            ]}
          >
            <Text color="primary">{revealed ? 'Hide' : 'Show'}</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
          {`⚠ ${error}`}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="textMuted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, alignSelf: 'stretch' },
  toggle: { alignItems: 'center', justifyContent: 'center' },
});
