import { Tabs } from 'expo-router';
import { useMemo } from 'react';

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

// Built once: they depend only on constants, so the tab bar gets stable props.
const RESTAURANTS_OPTIONS = tabOptions('Restaurants', 'restaurant');
const HOMEMADE_OPTIONS = tabOptions('Homemade', 'home');
const PROFILE_OPTIONS = tabOptions('Profile', 'person');
const MANAGE_OPTIONS = tabOptions('Manage', 'storefront');

// Hiding Manage is UX only; seller data is protected by RLS (spec 05+).
export default function TabsLayout() {
  const { colors, size } = useTheme();
  const isSeller = useIsSeller();
  const screenOptions = useMemo(
    () => ({
      headerShown: false,
      tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      tabBarItemStyle: { minHeight: size.touch },
    }),
    [colors.surface, colors.border, size.touch],
  );

  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen name="restaurants" options={RESTAURANTS_OPTIONS} />
      <Tabs.Screen name="homemade" options={HOMEMADE_OPTIONS} />
      <Tabs.Screen name="profile" options={PROFILE_OPTIONS} />
      <Tabs.Protected guard={isSeller} redirectTo="/restaurants">
        <Tabs.Screen name="manage" options={MANAGE_OPTIONS} />
      </Tabs.Protected>
    </Tabs>
  );
}
