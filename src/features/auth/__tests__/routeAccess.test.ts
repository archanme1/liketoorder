import { getHomeRoute, getPostAuthRoute, getRouteAccess } from '../routeAccess';

type Access = ReturnType<typeof getRouteAccess>;

const none: Access = {
  signedOutScreens: false,
  resetPassword: false,
  setupProfile: false,
  tabs: false,
  app: false,
  manage: false,
};

describe('getRouteAccess (spec 03 access table)', () => {
  it('guest: tabs, sign-in/up and reset-password; no setup-profile, app or Manage', () => {
    expect(getRouteAccess({ hasSession: false, isRecovering: false })).toEqual({
      ...none,
      signedOutScreens: true,
      resetPassword: true,
      tabs: true,
    });
  });

  it('guest never gets Manage, even if isSeller is passed as true', () => {
    const access = getRouteAccess({ hasSession: false, isRecovering: false, isSeller: true });
    expect(access.manage).toBe(false);
    expect(access.app).toBe(false);
  });

  it('recovering without a session: reset-password only', () => {
    expect(getRouteAccess({ hasSession: false, isRecovering: true })).toEqual({
      ...none,
      resetPassword: true,
    });
  });

  it('recovering with a session: reset-password only', () => {
    expect(getRouteAccess({ hasSession: true, isRecovering: true })).toEqual({
      ...none,
      resetPassword: true,
    });
  });

  it.each([
    [true, false],
    [false, false],
    [true, true],
    [false, true],
  ])(
    'recovering never reaches tabs, app, setup or Manage (profileComplete=%s isSeller=%s)',
    (profileComplete, isSeller) => {
      expect(
        getRouteAccess({ hasSession: true, isRecovering: true, profileComplete, isSeller }),
      ).toEqual({ ...none, resetPassword: true });
    },
  );

  it('signed in, profile incomplete: setup-profile only', () => {
    expect(
      getRouteAccess({ hasSession: true, isRecovering: false, profileComplete: false }),
    ).toEqual({ ...none, setupProfile: true });
  });

  it('signed in, profile incomplete, even with isSeller: no tabs, no Manage', () => {
    expect(
      getRouteAccess({
        hasSession: true,
        isRecovering: false,
        profileComplete: false,
        isSeller: true,
      }),
    ).toEqual({ ...none, setupProfile: true });
  });

  it('signed in, profile complete, not a seller: tabs and app, no Manage', () => {
    expect(
      getRouteAccess({
        hasSession: true,
        isRecovering: false,
        profileComplete: true,
        isSeller: false,
      }),
    ).toEqual({ ...none, tabs: true, app: true });
  });

  it('signed in, profile complete, isSeller unknown: no Manage', () => {
    expect(
      getRouteAccess({ hasSession: true, isRecovering: false, profileComplete: true }),
    ).toEqual({ ...none, tabs: true, app: true });
  });

  it('signed in, profile complete, seller: tabs, app and Manage', () => {
    expect(
      getRouteAccess({
        hasSession: true,
        isRecovering: false,
        profileComplete: true,
        isSeller: true,
      }),
    ).toEqual({ ...none, tabs: true, app: true, manage: true });
  });

  it('signed in while the profile is still loading (profileComplete undefined): not sent to setup', () => {
    const access = getRouteAccess({ hasSession: true, isRecovering: false });
    expect(access.setupProfile).toBe(false);
    expect(access.tabs).toBe(true);
    expect(access.app).toBe(true);
    expect(access.signedOutScreens).toBe(false);
    expect(access.resetPassword).toBe(false);
  });

  it('returns exactly the six documented keys', () => {
    expect(Object.keys(getRouteAccess({ hasSession: false, isRecovering: false })).sort()).toEqual(
      ['app', 'manage', 'resetPassword', 'setupProfile', 'signedOutScreens', 'tabs'].sort(),
    );
  });
});

describe('getHomeRoute', () => {
  it('guest -> /restaurants', () => {
    expect(getHomeRoute(getRouteAccess({ hasSession: false, isRecovering: false }))).toBe(
      '/restaurants',
    );
  });

  it('signed in with a complete profile -> /restaurants', () => {
    expect(
      getHomeRoute(
        getRouteAccess({ hasSession: true, isRecovering: false, profileComplete: true }),
      ),
    ).toBe('/restaurants');
  });

  it('seller -> /restaurants', () => {
    expect(
      getHomeRoute(
        getRouteAccess({
          hasSession: true,
          isRecovering: false,
          profileComplete: true,
          isSeller: true,
        }),
      ),
    ).toBe('/restaurants');
  });

  it('incomplete profile -> /setup-profile', () => {
    expect(
      getHomeRoute(
        getRouteAccess({ hasSession: true, isRecovering: false, profileComplete: false }),
      ),
    ).toBe('/setup-profile');
  });

  it('recovering -> /reset-password', () => {
    expect(getHomeRoute(getRouteAccess({ hasSession: true, isRecovering: true }))).toBe(
      '/reset-password',
    );
    expect(getHomeRoute(getRouteAccess({ hasSession: false, isRecovering: true }))).toBe(
      '/reset-password',
    );
  });
});

describe('getPostAuthRoute', () => {
  it('signed in with a complete profile -> /profile', () => {
    expect(
      getPostAuthRoute(
        getRouteAccess({ hasSession: true, isRecovering: false, profileComplete: true }),
      ),
    ).toBe('/profile');
  });

  it('seller -> /profile', () => {
    expect(
      getPostAuthRoute(
        getRouteAccess({
          hasSession: true,
          isRecovering: false,
          profileComplete: true,
          isSeller: true,
        }),
      ),
    ).toBe('/profile');
  });

  it('incomplete profile -> /setup-profile', () => {
    expect(
      getPostAuthRoute(
        getRouteAccess({ hasSession: true, isRecovering: false, profileComplete: false }),
      ),
    ).toBe('/setup-profile');
  });

  it('recovering -> /reset-password', () => {
    expect(getPostAuthRoute(getRouteAccess({ hasSession: true, isRecovering: true }))).toBe(
      '/reset-password',
    );
  });

  it('guest falls back to the home route (/restaurants)', () => {
    expect(getPostAuthRoute(getRouteAccess({ hasSession: false, isRecovering: false }))).toBe(
      '/restaurants',
    );
  });
});

// Spec 09: /requests/* (the form, My requests, a request) sits in the root layout's `app` guard,
// so it needs no code of its own here; these pin down who gets through.
describe('getRouteAccess: the requests screens use the signed-in `app` access', () => {
  it('a signed-in user with a complete profile can open them', () => {
    expect(
      getRouteAccess({ hasSession: true, isRecovering: false, profileComplete: true }).app,
    ).toBe(true);
  });

  it('a signed-in user whose profile status is not known yet can open them (same as edit profile)', () => {
    expect(getRouteAccess({ hasSession: true, isRecovering: false }).app).toBe(true);
  });

  it.each([
    ['a guest', { hasSession: false, isRecovering: false }],
    [
      'a guest passed profileComplete',
      { hasSession: false, isRecovering: false, profileComplete: true },
    ],
    ['someone mid-password-reset', { hasSession: true, isRecovering: true, profileComplete: true }],
    [
      'someone with no username yet',
      { hasSession: true, isRecovering: false, profileComplete: false },
    ],
  ])('%s cannot', (_label, input) => {
    expect(getRouteAccess(input).app).toBe(false);
  });

  it('a signed-in guest who tapped Request pickup lands on Profile by default after sign-in', () => {
    const access = getRouteAccess({ hasSession: true, isRecovering: false, profileComplete: true });
    expect(getPostAuthRoute(access)).toBe('/profile');
  });
});
