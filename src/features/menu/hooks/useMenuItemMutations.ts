import { useMutation, useQueryClient } from '@tanstack/react-query';

import { myBusinessKey } from '@/features/sellers/hooks/useMyBusiness';

import {
  createMenuItem,
  deleteMenuItem,
  moveMenuItem,
  setMenuCurrency,
  updateMenuItem,
  type MenuAppError,
  type MenuItemInput,
  type MoveDirection,
} from '../api';
import type { Menu, MenuItem } from '../schema';
import { runPhotoCleanup } from '../uploadBusinessPhoto';

import { menuKey } from './useMyMenu';

export function useSetMenuCurrency() {
  const queryClient = useQueryClient();
  return useMutation<void, MenuAppError, string>({
    mutationFn: (code) => setMenuCurrency(code),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: myBusinessKey }),
  });
}

export function useCreateMenuItem(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation<string, MenuAppError, MenuItemInput>({
    mutationFn: (input) => createMenuItem(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: menuKey(businessId) }),
  });
}

export function useUpdateMenuItem(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, MenuAppError, { itemId: string; input: MenuItemInput }>({
    mutationFn: ({ itemId, input }) => updateMenuItem(itemId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: menuKey(businessId) }),
  });
}

type Snapshot = { previous: Menu | undefined };

function patchItems(menu: Menu | undefined, change: (items: MenuItem[]) => MenuItem[]) {
  return menu ? { ...menu, items: change(menu.items) } : menu;
}

/** The Available switch in the list: optimistic, rolled back if the save fails. */
export function useSetItemAvailable(businessId: string) {
  const queryClient = useQueryClient();
  const key = menuKey(businessId);
  return useMutation<void, MenuAppError, { item: MenuItem; isAvailable: boolean }, Snapshot>({
    // update_menu_item takes every field, so the item's current values go with the new flag.
    mutationFn: ({ item, isAvailable }) =>
      updateMenuItem(item.id, {
        name: item.name,
        description: item.description,
        price_minor: item.price_minor,
        is_available: isAvailable,
      }),
    onMutate: async ({ item, isAvailable }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Menu>(key);
      queryClient.setQueryData<Menu>(key, (menu) =>
        patchItems(menu, (items) =>
          items.map((row) => (row.id === item.id ? { ...row, is_available: isAvailable } : row)),
        ),
      );
      return { previous };
    },
    onError: (_error, _vars, context) => queryClient.setQueryData(key, context?.previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** Up/down: swaps neighbours in the cache at once, rolled back if the server refuses. */
export function useMoveMenuItem(businessId: string) {
  const queryClient = useQueryClient();
  const key = menuKey(businessId);
  return useMutation<void, MenuAppError, { itemId: string; direction: MoveDirection }, Snapshot>({
    mutationFn: ({ itemId, direction }) => moveMenuItem(itemId, direction),
    onMutate: async ({ itemId, direction }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Menu>(key);
      queryClient.setQueryData<Menu>(key, (menu) =>
        patchItems(menu, (items) => {
          const index = items.findIndex((row) => row.id === itemId);
          const other = direction === 'up' ? index - 1 : index + 1;
          if (index < 0 || other < 0 || other >= items.length) return items;
          const next = [...items];
          next[index] = { ...items[other], position: items[index].position };
          next[other] = { ...items[index], position: items[other].position };
          return next;
        }),
      );
      return { previous };
    },
    onError: (_error, _vars, context) => queryClient.setQueryData(key, context?.previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** Deletes an item (its photo row goes with it), then removes the queued file. */
export function useDeleteMenuItem(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, MenuAppError, string>({
    mutationFn: (itemId) => deleteMenuItem(itemId),
    onSuccess: () => {
      void runPhotoCleanup();
      return queryClient.invalidateQueries({ queryKey: menuKey(businessId) });
    },
  });
}
