import { useNavigation, useRouter } from 'expo-router';

import { clearReturnTo } from '../returnTo';

// Leaves sign-in / sign-up for the tabs (keeping the tab the guest came from), even after
// switching between the two forms: the whole (auth) group is popped from the root stack.
// Opened directly, there's nothing beneath: go to Restaurants. Closing also forgets where a guest
// meant to go after signing in (the Request pickup button's return).
export function useCloseAuth() {
  const router = useRouter();
  const root = useNavigation().getParent();
  return () => {
    clearReturnTo();
    if (root?.canGoBack()) root.goBack();
    else router.replace('/restaurants');
  };
}
