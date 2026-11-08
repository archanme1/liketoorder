import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useContext } from 'react';

import { AuthContext } from '@/features/auth/components/AuthProvider';
import { requestFormHref, setReturnTo } from '@/features/auth/returnTo';
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
 * The actions a person can take on the business open in the sheet, in order. Today one: Request
 * pickup. A table request (spec 11) is one more entry here. An empty list means no row at all.
 *
 * - Outside the auth provider (nobody knows who is looking): none.
 * - Guest: Request pickup, which remembers the request form for this business and opens sign-in.
 * - Signed in: Request pickup, except for the business owner. Nothing shows while that is still
 *   being checked, so the owner never sees the button flash; if the check fails the server still
 *   answers own_business.
 * - `business` is null until the details have loaded and said the business is available.
 *
 * Navigation uses the imperative `router`, so this hook needs no navigation context and the sheet
 * renders anywhere the auth provider is absent.
 */
export function useSheetActions(business: { id: string; name: string } | null): SheetAction[] {
  const auth = useContext(AuthContext);
  const signedIn = auth !== null && auth.session !== null && !auth.isRecovering;
  const mine = useQuery({
    queryKey: myBusinessKey,
    queryFn: getMyBusiness,
    enabled: signedIn,
  });

  if (!auth || !business) return [];

  const label = `Request pickup from ${business.name}`;
  if (auth.session === null) {
    return [
      {
        key: 'request-pickup',
        title: 'Request pickup',
        accessibilityLabel: label,
        accessibilityHint: 'Opens sign in first',
        onPress: () => {
          setReturnTo(requestFormHref(business.id));
          router.push('/sign-in');
        },
      },
    ];
  }

  if (mine.isPending || mine.data?.id === business.id) return [];
  return [
    {
      key: 'request-pickup',
      title: 'Request pickup',
      accessibilityLabel: label,
      onPress: () =>
        router.push({ pathname: '/requests/new', params: { businessId: business.id } }),
    },
  ];
}
