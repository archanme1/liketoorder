import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useContext } from 'react';

import { AuthContext } from '@/features/auth/components/AuthProvider';
import { requestFormHref, setReturnTo, tableRequestFormHref } from '@/features/auth/returnTo';
import { getMyBusiness } from '@/features/sellers/api';
import { myBusinessKey } from '@/features/sellers/hooks/useMyBusiness';

/** One button in the sheet's fixed action row. */
export type SheetAction = {
  key: string;
  title: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress: () => void;
};

/**
 * The actions a person can take on the business open in the sheet, in order: Request pickup, and
 * Request table when the restaurant takes table requests (spec 11). An empty list means no row at all.
 *
 * - Outside the auth provider (nobody knows who is looking): none.
 * - Guest: the same buttons, each remembering its request form for this business and opening sign-in.
 * - Signed in: the buttons, except for the business owner. Nothing shows while that is still
 *   being checked, so the owner never sees the button flash; if the check fails the server still
 *   answers own_business.
 * - `business` is null until the details have loaded and said the business is available.
 *
 * Navigation uses the imperative `router`, so this hook needs no navigation context and the sheet
 * renders anywhere the auth provider is absent.
 */
// Coupling, on purpose: the own-business query below repeats the options of `useMyBusiness`
// (sellers) with the same query key, instead of calling that hook, because `useMyBusiness` reads
// the session through `useSession`, which throws outside the auth provider, and the map sheets
// must render without one. If those options change in sellers, change them here too; the
// proper fix is an optional-provider variant of `useMyBusiness` (not worth it for one caller).
export function useSheetActions(
  business: { id: string; name: string; acceptsTableRequests?: boolean } | null,
): SheetAction[] {
  const auth = useContext(AuthContext);
  const signedIn = auth !== null && auth.session !== null && !auth.isRecovering;
  const mine = useQuery({
    queryKey: myBusinessKey,
    queryFn: getMyBusiness,
    enabled: signedIn,
  });

  if (!auth || !business) return [];

  // Request table is only offered where the restaurant says it takes them: the flag comes from the
  // restaurant details the sheet already loaded, and homemade sheets never pass it.
  const takesTables = business.acceptsTableRequests === true;
  const pickupLabel = `Request pickup from ${business.name}`;
  const tableLabel = `Request a table at ${business.name}`;

  if (auth.session === null) {
    const guest = (href: string) => () => {
      setReturnTo(href);
      router.push('/sign-in');
    };
    return [
      {
        key: 'request-pickup',
        title: 'Request pickup',
        accessibilityLabel: pickupLabel,
        accessibilityHint: 'Opens sign in first',
        onPress: guest(requestFormHref(business.id)),
      },
      ...(takesTables
        ? [
            {
              key: 'request-table',
              title: 'Request table',
              accessibilityLabel: tableLabel,
              accessibilityHint: 'Opens sign in first',
              onPress: guest(tableRequestFormHref(business.id)),
            },
          ]
        : []),
    ];
  }

  if (mine.isPending || mine.data?.id === business.id) return [];
  return [
    {
      key: 'request-pickup',
      title: 'Request pickup',
      accessibilityLabel: pickupLabel,
      onPress: () =>
        router.push({ pathname: '/requests/new', params: { businessId: business.id } }),
    },
    ...(takesTables
      ? [
          {
            key: 'request-table',
            title: 'Request table',
            accessibilityLabel: tableLabel,
            onPress: () =>
              router.push({
                pathname: '/requests/table/new',
                params: { businessId: business.id },
              }),
          },
        ]
      : []),
  ];
}
