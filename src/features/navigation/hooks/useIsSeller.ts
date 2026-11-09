import { useSession } from '@/features/auth/hooks/useSession';
import { getRouteAccess, type RouteAccess } from '@/features/auth/routeAccess';
import { useMyProfile } from '@/features/profile/hooks/useMyProfile';

// What the tab bar may show: false/off for guests, mid-recovery and while the profile loads. Shares
// ['profile','me'] with the root layout, so a refetch with a changed is_seller updates the tab bar.
// UX only — RLS protects data.
export function useTabAccess(): RouteAccess {
  const { session, isRecovering } = useSession();
  const signedIn = session !== null && !isRecovering;
  const profile = useMyProfile({ enabled: signedIn });

  return getRouteAccess({
    hasSession: session !== null,
    isRecovering,
    profileComplete: signedIn ? Boolean(profile.data?.username) : undefined,
    isSeller: profile.data?.is_seller === true,
  });
}

export function useIsSeller(): boolean {
  return useTabAccess().manage;
}
