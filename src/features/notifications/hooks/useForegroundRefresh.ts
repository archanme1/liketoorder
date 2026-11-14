import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { requestKeys } from '@/features/requests/hooks/keys';

import { onForegroundPush } from '../pushModule';
import { tapPayloadSchema } from '../schema';

/**
 * A push that arrives while the app is open means something changed on the server: the lists,
 * the counts and that request's detail are read again (stale-list rule). The banner itself is
 * shown by the foreground handler (Decision 13).
 */
export function useForegroundRefresh(): void {
  const client = useQueryClient();

  useEffect(
    () =>
      onForegroundPush((data) => {
        void client.invalidateQueries({ queryKey: requestKeys.mine });
        void client.invalidateQueries({ queryKey: requestKeys.inboxAll });
        void client.invalidateQueries({ queryKey: requestKeys.waitingCount });
        void client.invalidateQueries({ queryKey: requestKeys.updatesCount });
        const payload = tapPayloadSchema.safeParse(data);
        if (!payload.success) return;
        const { id, side } = payload.data;
        void client.invalidateQueries({
          queryKey: side === 'sent' ? requestKeys.detail(id) : requestKeys.businessDetail(id),
        });
      }),
    [client],
  );
}
