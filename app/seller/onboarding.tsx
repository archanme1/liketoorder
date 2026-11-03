import { SellerOnboardingScreen } from '@/features/sellers/components/SellerOnboardingScreen';

// Signed in with a complete profile (root `app` guard). The screen redirects users who already
// have a business once it has loaded (spec 05 Decision 14).
export default function SellerOnboardingRoute() {
  return <SellerOnboardingScreen />;
}
