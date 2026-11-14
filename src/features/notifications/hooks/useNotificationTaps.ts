import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { clearLastTap, getLastTap, onTap, type PushTap } from '../pushModule';
import { tapPayloadSchema } from '../schema';

// Taps already routed in this app run, by notification identifier: the cold-start tap is also
// reported to the listener on some platforms, and the root can re-mount, so one tap routes once.
const handled = new Set<string>();

/** Test-only: forget the taps routed so far. */
export function resetHandledTapsForTests(): void {
  handled.clear();
}

/**
 * Routes a tap on a notification: a valid payload goes to the resolver (/notifications/open),
 * which checks the session and the account; anything else goes to the Requests tab. Only a tap on
 * the notification itself counts (not an action button). Cold start reads the last response once;
 * warm taps come from the listener.
 */
export function useNotificationTaps(): void {
  const router = useRouter();

  useEffect(() => {
    const route = (tap: PushTap | null) => {
      if (!tap || !tap.isDefaultAction || handled.has(tap.identifier)) return;
      handled.add(tap.identifier);
      clearLastTap();
      const payload = tapPayloadSchema.safeParse(tap.data);
      if (!payload.success) {
        router.push('/requests');
        return;
      }
      const { kind, id, side } = payload.data;
      router.push({ pathname: '/notifications/open', params: { v: '1', kind, id, side } });
    };

    route(getLastTap());
    return onTap(route);
  }, [router]);
}
