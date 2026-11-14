import { usePathname, useRouter } from 'expo-router';
import { useEffect, useSyncExternalStore } from 'react';

import { useSession } from '@/features/auth/hooks/useSession';

import {
  PRIMER_SETTLE_MS,
  clearPendingPrimer,
  getPendingPrimer,
  hasOpenedThisRun,
  markOpenedThisRun,
  readPrimerSeen,
  requestPrimer,
  savePrimerSeen,
  subscribePrimer,
  type PrimerRole,
} from '../primerMoment';

import { useNotificationPermission } from './useNotificationPermission';

/** For the screens that mark a primer moment. Asking is all they do; see usePrimerOpener. */
export function usePrimerMoment(): { maybeOpen: (role: PrimerRole) => void } {
  return { maybeOpen: requestPrimer };
}

/**
 * Mounted once, at the root. Opens the primer for a pending moment when the person is signed in,
 * has never been asked by the phone, has not seen the primer on this phone and has not had it in
 * this app run, and only once the route has stayed the same for `settleMs`: every navigation
 * (View my requests, Done, the move to Manage after onboarding) starts the wait again, so the
 * primer never opens while a navigation is in progress or fights the router.
 */
export function usePrimerOpener(settleMs: number = PRIMER_SETTLE_MS): void {
  const router = useRouter();
  const pathname = usePathname();
  const { session, isRecovering } = useSession();
  const userId = isRecovering ? undefined : session?.user.id;
  const { state } = useNotificationPermission();
  const pending = useSyncExternalStore(subscribePrimer, getPendingPrimer);

  useEffect(() => {
    if (!pending) return;
    if (!userId || (state !== undefined && state !== 'undetermined') || hasOpenedThisRun(userId)) {
      clearPendingPrimer();
      return;
    }
    // Still reading the permission, or a notification screen is already up: keep waiting.
    if (state === undefined || pathname.startsWith('/notifications')) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const seen = await readPrimerSeen(userId);
        if (cancelled) return;
        clearPendingPrimer();
        if (seen) return;
        markOpenedThisRun(userId);
        void savePrimerSeen(userId);
        router.push({ pathname: '/notifications/allow', params: { role: pending } });
      })();
    }, settleMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pending, pathname, userId, state, settleMs, router]);
}
