import { useNavigation, useRouter } from 'expo-router';

// Leaves sign-in / sign-up for the tabs (keeping the tab the guest came from), even after
// switching between the two forms: the whole (auth) group is popped from the root stack.
// Opened directly, there's nothing beneath: go to Restaurants.
export function useCloseAuth() {
  const router = useRouter();
  const root = useNavigation().getParent();
  return () => (root?.canGoBack() ? root.goBack() : router.replace('/restaurants'));
}
