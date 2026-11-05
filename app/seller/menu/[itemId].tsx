import { MenuItemFormScreen } from '@/features/menu/components/MenuItemFormScreen';

// Signed in with a complete profile (root `app` guard). Without a business the screen redirects
// to onboarding once it has loaded (spec 05 Decision 14). An unknown item shows an empty state.
export default function EditMenuItemRoute() {
  return <MenuItemFormScreen mode="edit" />;
}
