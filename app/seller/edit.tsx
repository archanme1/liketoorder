import { EditBusinessScreen } from '@/features/sellers/components/EditBusinessScreen';

// Signed in with a complete profile (root `app` guard). Without a business the screen redirects
// to onboarding once it has loaded (spec 05 Decision 14).
export default function EditBusinessRoute() {
  return <EditBusinessScreen />;
}
