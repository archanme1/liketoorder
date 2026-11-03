import { ComingSoon } from '@/features/navigation/components/ComingSoon';

// Seller only: the tab layout's Tabs.Protected redirects everyone else to /restaurants.
export default function ManageScreen() {
  return <ComingSoon title="Manage Business" message="Your business tools are coming soon." />;
}
