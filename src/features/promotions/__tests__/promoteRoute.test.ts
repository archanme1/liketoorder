import { getSellerRoute } from '@/features/sellers/sellerRoutes';

// Spec 16: /seller/promote follows the same rule as the other seller screens that need a business
// (spec 05 Decision 14). UX only: the promotion functions check the caller's business themselves.
const business = { id: 'b1' };

describe('getSellerRoute: the promote screen', () => {
  it('sends a user with no business to onboarding', () => {
    expect(getSellerRoute(null, false, 'promote')).toBe('/seller/onboarding');
    expect(getSellerRoute(null, true, 'promote')).toBe('/seller/onboarding');
  });

  it('stays on the screen for an owner, seller mode on or off', () => {
    expect(getSellerRoute(business, true, 'promote')).toBeNull();
    expect(getSellerRoute(business, false, 'promote')).toBeNull();
  });
});
