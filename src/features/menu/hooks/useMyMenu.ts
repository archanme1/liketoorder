import { useQuery } from '@tanstack/react-query';

import { getMenu, type MenuAppError } from '../api';
import type { Menu } from '../schema';

export const menuKey = (businessId: string) => ['menu', businessId] as const;

/** A business's items and photos. Loaded inside the gated screens, after the business. */
export function useMyMenu(businessId: string) {
  return useQuery<Menu, MenuAppError>({
    queryKey: menuKey(businessId),
    queryFn: () => getMenu(businessId),
  });
}
