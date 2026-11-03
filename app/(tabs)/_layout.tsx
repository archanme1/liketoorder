import { Tabs } from 'expo-router';

import { TabIcon, type TabIconName } from '@/features/navigation/components/TabIcon';
import { TabLabel } from '@/features/navigation/components/TabLabel';
import { useIsSeller } from '@/features/navigation/hooks/useIsSeller';
import { useTheme } from '@/theme/useTheme';

function tabOptions(label: string, icon: TabIconName) {
  return {
    title: label,
    tabBarAccessibilityLabel: `${label} tab`,
    tabBarLabel: ({ focused }: { focused: boolean }) => (
      <TabLabel label={label} focused={focused} />
    ),
    tabBarIcon: ({ focused }: { focused: boolean }) => <TabIcon name={icon} focused={focused} />,
  };
}

// Hiding Manage is UX only; seller data is protected by RLS (spec 05+).
export default function TabsLayout() {
  const { colors, size } = useTheme();
  const isSeller = useIsSeller();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarItemStyle: { minHeight: size.touch },
      }}
    >
      <Tabs.Screen name="restaurants" options={tabOptions('Restaurants', 'restaurant')} />
      <Tabs.Screen name="homemade" options={tabOptions('Homemade', 'home')} />
      <Tabs.Screen name="profile" options={tabOptions('Profile', 'person')} />
      <Tabs.Protected guard={isSeller} redirectTo="/restaurants">
        <Tabs.Screen name="manage" options={tabOptions('Manage', 'storefront')} />
      </Tabs.Protected>
    </Tabs>
  );
}
