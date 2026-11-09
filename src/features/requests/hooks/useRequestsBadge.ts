import { useSession } from '@/features/auth/hooks/useSession';
import { useMyBusiness } from '@/features/sellers/hooks/useMyBusiness';

import { useCustomerUpdates } from './useCustomerUpdates';
import { useWaitingCount } from './useWaitingCount';

export type RequestsCounts = {
  /** The person owns a business, whatever the seller mode. Undefined until that is known. */
  isOwner: boolean | undefined;
  /** Requests waiting for this person's answer (owners only). Undefined: not known, show no number. */
  received: number | undefined;
  /** Own requests that changed since the Sent list was last opened. Undefined: show no number. */
  sent: number | undefined;
  /** The Requests tab number: received + sent for an owner, sent for a customer. */
  total: number | undefined;
  /** Marks every loaded request as seen (the Sent list calls this when it is on screen). */
  markSentSeen: () => void;
};

/**
 * The numbers behind the Requests tab and its two switches. A number that is loading or failed is
 * `undefined`, never zero or stale: while it is not known whether the person owns a business, the
 * total is undefined too, because it would be the wrong sum.
 */
export function useRequestsCounts(): RequestsCounts {
  const { session, isRecovering } = useSession();
  const signedIn = session !== null && !isRecovering;
  const business = useMyBusiness();
  const isOwner = !signedIn || !business.isSuccess ? undefined : business.data !== null;
  const waiting = useWaitingCount({ enabled: isOwner === true });
  const updates = useCustomerUpdates();

  const received = isOwner === true && waiting.isSuccess ? waiting.data.waiting : undefined;
  const sent = updates.count;

  let total: number | undefined;
  if (isOwner === true) {
    total = received === undefined && sent === undefined ? undefined : (received ?? 0) + (sent ?? 0);
  } else if (isOwner === false) {
    total = sent;
  }
  return { isOwner, received, sent, total, markSentSeen: updates.markSeen };
}

/** The number on the Requests tab, or undefined when there is none to show. */
export function useRequestsBadge(): number | undefined {
  return useRequestsCounts().total;
}
