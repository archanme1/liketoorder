import { ManageBusinessScreen } from '@/features/sellers/components/ManageBusinessScreen';

// Seller only: the tab layout's Tabs.Protected redirects everyone else to /restaurants.
export default function ManageScreen() {
  return <ManageBusinessScreen />;
}
