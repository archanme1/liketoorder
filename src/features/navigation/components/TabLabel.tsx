import { Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

type TabLabelProps = {
  label: string;
  focused: boolean;
};

// Always visible; bold when focused so focus isn't shown by color alone.
export function TabLabel({ label, focused }: TabLabelProps) {
  const { weight } = useTheme();
  return (
    <Text
      variant="caption"
      color={focused ? 'primary' : 'textMuted'}
      style={{ fontWeight: focused ? weight.bold : weight.regular }}
    >
      {label}
    </Text>
  );
}
