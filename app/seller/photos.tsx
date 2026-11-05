import { BusinessPhotosScreen } from '@/features/menu/components/BusinessPhotosScreen';

// Signed in with a complete profile (root `app` guard). Without a business the screen redirects
// to onboarding once it has loaded (spec 05 Decision 14).
export default function BusinessPhotosRoute() {
  return <BusinessPhotosScreen />;
}
