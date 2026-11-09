import { getSellerRoute } from '../sellerRoutes';

// Spec 05 "Access rules (Decision 14)": rows 2 and 3 of the table, for every seller screen.
// Rows with guests, recovering and incomplete profiles never reach these screens (root guard).

const business = { id: 'b1' };

describe('getSellerRoute: signed in, complete profile, no business', () => {
  it('stays on /seller/onboarding', () => {
    expect(getSellerRoute(null, false, 'onboarding')).toBeNull();
  });

  it('sends /seller/edit to /seller/onboarding', () => {
    expect(getSellerRoute(null, false, 'edit')).toBe('/seller/onboarding');
  });

  it('sends /seller/address to /seller/onboarding', () => {
    expect(getSellerRoute(null, false, 'address')).toBe('/seller/onboarding');
  });

  it('treats a stale seller flag with no business the same way', () => {
    expect(getSellerRoute(null, true, 'onboarding')).toBeNull();
    expect(getSellerRoute(null, true, 'edit')).toBe('/seller/onboarding');
    expect(getSellerRoute(null, true, 'address')).toBe('/seller/onboarding');
  });
});

describe('getSellerRoute: has a business, seller mode on', () => {
  it('sends /seller/onboarding to /manage', () => {
    expect(getSellerRoute(business, true, 'onboarding')).toBe('/manage');
  });

  it('stays on /seller/edit', () => {
    expect(getSellerRoute(business, true, 'edit')).toBeNull();
  });

  it('stays on /seller/address', () => {
    expect(getSellerRoute(business, true, 'address')).toBeNull();
  });
});

// Spec 06 "Access rules": menu, menu-item and photos follow the same rule as 'edit'. Spec 10: the
// seller inbox and its request screen follow it too (an owner with seller mode off can still answer
// requests already sent, Decision 11).
describe.each(['menu', 'menu-item', 'photos', 'requests', 'request'] as const)(
  'getSellerRoute: the %s screen (spec 06)',
  (screen) => {
    it('sends a user with no business to /seller/onboarding', () => {
      expect(getSellerRoute(null, false, screen)).toBe('/seller/onboarding');
    });

    it('sends a stale seller flag with no business to /seller/onboarding too', () => {
      expect(getSellerRoute(null, true, screen)).toBe('/seller/onboarding');
    });

    it('stays on the screen for an owner with seller mode on', () => {
      expect(getSellerRoute(business, true, screen)).toBeNull();
    });

    it('stays on the screen for an owner with seller mode off', () => {
      expect(getSellerRoute(business, false, screen)).toBeNull();
    });
  },
);

describe('getSellerRoute: has a business, seller mode off', () => {
  it('sends /seller/onboarding to /profile', () => {
    expect(getSellerRoute(business, false, 'onboarding')).toBe('/profile');
  });

  it('stays on /seller/edit', () => {
    expect(getSellerRoute(business, false, 'edit')).toBeNull();
  });

  it('stays on /seller/address', () => {
    expect(getSellerRoute(business, false, 'address')).toBeNull();
  });
});
