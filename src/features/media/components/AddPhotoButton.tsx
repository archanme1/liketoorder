import { View } from 'react-native';

import { Button, Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

type AddPhotoButtonProps = {
  label: string;
  onPress: () => void;
  uploading?: boolean;
  /** Set when the section is full (or adding isn't possible): disables the button and says why. */
  disabledReason?: string;
};

export function AddPhotoButton({
  label,
  onPress,
  uploading = false,
  disabledReason,
}: AddPhotoButtonProps) {
  const { space } = useTheme();
  const disabled = disabledReason !== undefined;
  return (
    <View style={{ gap: space.xs }}>
      <Button
        title={uploading ? 'Uploading…' : label}
        variant="secondary"
        onPress={onPress}
        disabled={disabled || uploading}
        accessibilityLabel={uploading ? 'Uploading photo' : label}
        accessibilityHint={disabledReason}
      />
      {disabledReason ? (
        <Text variant="caption" color="textMuted">
          {disabledReason}
        </Text>
      ) : null}
    </View>
  );
}
