import type { RequestStatus } from './schema';

export type StatusTone = 'warning' | 'success' | 'danger' | 'muted' | 'info';

export type StatusInfo = {
  /** The word shown on the chip and spoken by screen readers. */
  label: string;
  tone: StatusTone;
  /** An Ionicons name; the chip always shows the word too, never the icon or colour alone. */
  icon:
    | 'time-outline'
    | 'checkmark-circle-outline'
    | 'close-circle-outline'
    | 'hourglass-outline'
    | 'ban-outline'
    | 'bag-check-outline'
    | 'alert-circle-outline';
};

// Wording for each status. A pending request is "Waiting", never anything that reads as booked,
// confirmed or on its way.
export const STATUS_INFO: Record<RequestStatus, StatusInfo> = {
  pending: { label: 'Waiting', tone: 'warning', icon: 'time-outline' },
  accepted: { label: 'Accepted', tone: 'success', icon: 'checkmark-circle-outline' },
  declined: { label: 'Declined', tone: 'danger', icon: 'close-circle-outline' },
  expired: { label: 'Expired', tone: 'muted', icon: 'hourglass-outline' },
  cancelled: { label: 'Cancelled', tone: 'muted', icon: 'ban-outline' },
  completed: { label: 'Completed', tone: 'info', icon: 'bag-check-outline' },
  no_show: { label: 'No-show', tone: 'danger', icon: 'alert-circle-outline' },
};

/** The sentence under a status on the detail screen and in the list. */
export function statusSentence(status: RequestStatus, sellerName: string): string {
  switch (status) {
    case 'pending':
      return `Waiting for ${sellerName} to respond`;
    case 'accepted':
      return `${sellerName} accepted your request`;
    case 'declined':
      return `${sellerName} declined your request`;
    case 'expired':
      return `${sellerName} didn't respond in time`;
    case 'cancelled':
      return 'You cancelled this request';
    case 'completed':
      return 'Pickup completed';
    case 'no_show':
      return 'Marked as not picked up';
  }
}

/** How far the phone's clock is ahead of the server's, in ms (negative when behind). */
export function clockOffset(serverNow: string | Date, deviceNow: number | Date): number {
  return new Date(deviceNow).getTime() - new Date(serverNow).getTime();
}

/**
 * Milliseconds until `expiresAt` on the SERVER's clock, given the offset. Used only to time a
 * refetch: the status shown always comes from the server's display_status. Never negative.
 */
export function msUntilExpiry(expiresAt: string, offset: number, deviceNow: number): number {
  return Math.max(0, new Date(expiresAt).getTime() + offset - deviceNow);
}
