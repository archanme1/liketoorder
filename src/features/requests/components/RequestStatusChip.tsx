import { StatusChip } from '@/components/ui';

import type { RequestStatus } from '../schema';
import { STATUS_INFO } from '../status';

/** The chip for a request's display_status (the server's word, never worked out on the phone). */
export function RequestStatusChip({ status }: { status: RequestStatus }) {
  const info = STATUS_INFO[status];
  return <StatusChip label={info.label} tone={info.tone} icon={info.icon} />;
}
