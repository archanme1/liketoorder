import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { ErrorState, Screen } from '@/components/ui';
import { useSession } from '@/features/auth/hooks/useSession';
import { notificationOpenHref, clearReturnTo, setReturnTo } from '@/features/auth/returnTo';
import { getHomeRoute, getRouteAccess } from '@/features/auth/routeAccess';
import { useMyProfile } from '@/features/profile/hooks/useMyProfile';
import { useMyBusiness } from '@/features/sellers/hooks/useMyBusiness';
import { sellerErrorMessage } from '@/features/sellers/messages';
import { useTheme } from '@/theme/useTheme';

import { tapParamsSchema } from '../schema';

type NotificationOpenResolverProps = { params: Record<string, string | string[] | undefined> };

/**
 * Where a tapped notification lands. It shows nothing private: it validates the payload, waits for
 * the session, and only then routes. Signed out (or the profile is not finished): it remembers
 * itself as the return-to target and goes to sign-in, then runs again. Sent: the customer detail,
 * whose server read already answers "not found" for someone else's request. Received: the owner
 * detail only when this account has a business; otherwise the Requests tab with a neutral line,
 * never onboarding (SellerScreenGate would send a business-less account there).
 */
export function NotificationOpenResolver({ params }: NotificationOpenResolverProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const { session, isLoading, isRecovering } = useSession();
  const signedIn = session !== null && !isRecovering;
  const profile = useMyProfile({ enabled: signedIn });
  const business = useMyBusiness();
  const parsed = tapParamsSchema.safeParse(params);
  const routed = useRef(false);

  const target = parsed.success ? parsed.data : null;
  const profileKnown = !signedIn || !profile.isPending;
  const profileComplete = signedIn && Boolean(profile.data?.username);
  const side = target?.side;
  const businessState = business.isPending
    ? 'pending'
    : business.isError && business.data === undefined
      ? 'error'
      : business.data
        ? 'owner'
        : 'none';

  useEffect(() => {
    if (routed.current || isLoading) return;
    if (!target) {
      routed.current = true;
      router.replace('/requests');
      return;
    }
    if (!profileKnown) return;
    if (!signedIn || !profileComplete) {
      routed.current = true;
      setReturnTo(notificationOpenHref(target));
      const access = getRouteAccess({
        hasSession: session !== null,
        isRecovering,
        profileComplete: signedIn ? profileComplete : undefined,
      });
      router.replace(signedIn ? getHomeRoute(access) : '/sign-in');
      return;
    }
    if (target.side === 'sent') {
      routed.current = true;
      clearReturnTo();
      router.replace({ pathname: '/requests/[id]', params: { id: target.id, kind: target.kind } });
      return;
    }
    if (businessState === 'pending' || businessState === 'error') return;
    routed.current = true;
    clearReturnTo();
    if (businessState === 'owner') {
      router.replace({ pathname: '/seller/requests/[id]', params: { id: target.id } });
    } else {
      router.replace({ pathname: '/requests', params: { notice: 'other-account' } });
    }
  }, [
    isLoading,
    target,
    profileKnown,
    signedIn,
    profileComplete,
    session,
    isRecovering,
    businessState,
    router,
  ]);

  if (signedIn && side === 'received' && businessState === 'error' && business.error) {
    return (
      <Screen>
        <ErrorState
          message={sellerErrorMessage(business.error.code)}
          onRetry={() => void business.refetch()}
          retrying={business.isRefetching}
        />
      </Screen>
    );
  }
  return (
    <Screen style={styles.center}>
      <ActivityIndicator color={colors.primary} accessibilityLabel="Opening the notification" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
