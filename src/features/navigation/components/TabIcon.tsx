import Ionicons from '@expo/vector-icons/Ionicons';

import { useTheme } from '@/theme/useTheme';

export type TabIconName = 'restaurant' | 'home' | 'person' | 'storefront';

type TabIconProps = {
  name: TabIconName;
  focused: boolean;
};

// Filled when focused, outline otherwise, so focus isn't shown by color alone.
// Decorative: the tab's label and accessibilityLabel describe it.
export function TabIcon({ name, focused }: TabIconProps) {
  const { colors, size } = useTheme();
  return (
    <Ionicons
      name={focused ? name : `${name}-outline`}
      size={size.tabIcon}
      color={focused ? colors.primary : colors.textMuted}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
