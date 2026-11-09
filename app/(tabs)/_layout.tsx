import { Tabs } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { TabBadge, spokenBadge } from '@/features/navigation/components/TabBadge';
import { TabIcon, type TabIconName } from '@/features/navigation/components/TabIcon';
import { TabLabel } from '@/features/navigation/components/TabLabel';
import { useTabVisibility } from '@/features/navigation/hooks/useTabVisibility';
import { useRequestsBadge } from '@/features/requests/hooks/useRequestsBadge';
import { useTheme } from '@/theme/useTheme';

function tabOptions(label: string, icon: TabIconName, badge?: number) {
  const spoken = spokenBadge(badge);
  return {
    title: label,
    tabBarAccessibilityLabel: spoken ? `${label} tab, ${spoken}` : `${label} tab`,
    tabBarLabel: ({ focused }: { focused: boolean }) => (
      <TabLabel label={label} focused={focused} />
    ),
    tabBarIcon: ({ focused }: { focused: boolean }) => (
      <View>
        <TabIcon name={icon} focused={focused} />
        {badge === undefined ? null : <TabBadge count={badge} />}
      </View>
    ),
  };
}

// Built once: they depend only on constants, so the tab bar gets stable props.
const RESTAURANTS_OPTIONS = tabOptions('Restaurants', 'restaurant');
const HOMEMADE_OPTIONS = tabOptions('Homemade', 'home');
const PROFILE_OPTIONS = tabOptions('Profile', 'person');
const MANAGE_OPTIONS = tabOptions('Manage', 'storefront');

// Which tabs show is decided in one place (useTabVisibility). Hiding is UX only: seller data and
// every request are protected by RLS. A guest sees Restaurants, Homemade, Profile; a customer adds
// Requests; a seller (seller mode on) sees Requests, Manage, Profile, so the home route
// /restaurants sends a seller to Requests as soon as the profile has loaded.
export default function TabsLayout() {
  const { colors, size } = useTheme();
  const visibility = useTabVisibility();
  const badge = useRequestsBadge();
  const screenOptions = useMemo(
    () => ({
      headerShown: false,
      tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      tabBarItemStyle: { minHeight: size.touch },
    }),
    [colors.surface, colors.border, size.touch],
  );
  const requestsOptions = useMemo(() => tabOptions('Requests', 'receipt', badge), [badge]);

  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Protected guard={visibility.maps} redirectTo="/requests">
        <Tabs.Screen name="restaurants" options={RESTAURANTS_OPTIONS} />
        <Tabs.Screen name="homemade" options={HOMEMADE_OPTIONS} />
      </Tabs.Protected>
      <Tabs.Protected guard={visibility.requests} redirectTo="/restaurants">
        <Tabs.Screen name="requests" options={requestsOptions} />
      </Tabs.Protected>
      <Tabs.Protected guard={visibility.manage} redirectTo="/restaurants">
        <Tabs.Screen name="manage" options={MANAGE_OPTIONS} />
      </Tabs.Protected>
      <Tabs.Screen name="profile" options={PROFILE_OPTIONS} />
    </Tabs>
  );
}
