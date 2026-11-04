import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';

import { ErrorState } from '@/components/ui';
import { useIsSeller } from '@/features/navigation/hooks/useIsSeller';

import { useMyBusiness } from '../hooks/useMyBusiness';
import { sellerErrorMessage } from '../messages';
import type { MyBusiness } from '../schema';
import { getSellerRoute, type SellerScreen } from '../sellerRoutes';

import { SellerLoading } from './SellerLoading';

type SellerScreenGateProps = {
  /** Every screen that needs a business (seller mode on or off), so not onboarding. */
  screen: Exclude<SellerScreen, 'onboarding'>;
  children: (business: MyBusiness) => ReactNode;
};

// Decision 14: the business-based redirect happens here, inside the screen, after the business
// has loaded. No layout guards on business state, so the Stack never swaps or unmounts while
// the query loads. UX only — RLS and the seller functions enforce the rules.
export function SellerScreenGate({ screen, children }: SellerScreenGateProps) {
  const business = useMyBusiness();
  const isSeller = useIsSeller();

  if (business.isPending) return <SellerLoading />;
  // A failed background refetch keeps the loaded screen.
  if (business.isError && business.data === undefined) {
    return (
      <ErrorState
        message={sellerErrorMessage(business.error.code)}
        onRetry={() => void business.refetch()}
        retrying={business.isRefetching}
      />
    );
  }
  // getSellerRoute is non-null exactly when there is no business for these screens.
  const redirect = getSellerRoute(business.data ?? null, isSeller, screen);
  if (redirect) return <Redirect href={redirect} />;
  if (!business.data) return <Redirect href="/seller/onboarding" />;
  return children(business.data);
}
