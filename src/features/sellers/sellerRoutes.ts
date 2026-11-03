// Where a seller screen sends the user once their business has loaded (spec 05 Decision 14).
// UX only: the database enforces every rule. Guests, mid-recovery and incomplete profiles never
// reach these screens; the root layout's `app` guard handles them.

export type SellerScreen = 'onboarding' | 'edit' | 'address';

export type SellerRedirect = '/manage' | '/profile' | '/seller/onboarding';

/** null means stay on the screen. */
export function getSellerRoute(
  business: { id: string } | null,
  isSeller: boolean,
  screen: SellerScreen,
): SellerRedirect | null {
  if (screen === 'onboarding') {
    if (!business) return null;
    return isSeller ? '/manage' : '/profile';
  }
  return business ? null : '/seller/onboarding';
}
