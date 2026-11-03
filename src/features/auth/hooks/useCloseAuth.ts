import { useRouter } from 'expo-router';

// Leaves sign-in / sign-up for the tabs: back where the guest came from, else Restaurants.
export function useCloseAuth() {
  const router = useRouter();
  return () => (router.canGoBack() ? router.back() : router.replace('/restaurants'));
}
