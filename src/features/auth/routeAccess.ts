// Which route groups the root layout's Stack.Protected guards allow. UX only — RLS protects data.

export type RouteAccessInput = {
  hasSession: boolean;
  /** A reset code was verified but the new password isn't saved yet. */
  isRecovering: boolean;
  /** Whether profiles.username is set. Omitted means "not checked" and counts as complete. */
  profileComplete?: boolean;
  /** profiles.is_seller. Omitted means not a seller. */
  isSeller?: boolean;
};

export type RouteAccess = {
  /** sign-in, sign-up, verify-email, forgot-password */
  signedOutScreens: boolean;
  /** reset-password: signed out, or mid-recovery */
  resetPassword: boolean;
  /** setup-profile: signed in, not recovering, username not set yet */
  setupProfile: boolean;
  /** the tabs: guests, and signed-in users with a complete profile; never mid-recovery */
  tabs: boolean;
  /** signed-in only app screens (edit profile) */
  app: boolean;
  /** the Manage tab: signed in, profile complete, seller */
  manage: boolean;
};

export function getRouteAccess({
  hasSession,
  isRecovering,
  profileComplete,
  isSeller,
}: RouteAccessInput): RouteAccess {
  const signedIn = hasSession && !isRecovering;
  const app = signedIn && profileComplete !== false;
  return {
    signedOutScreens: !hasSession && !isRecovering,
    resetPassword: !hasSession || isRecovering,
    setupProfile: signedIn && profileComplete === false,
    tabs: !isRecovering && (!hasSession || profileComplete !== false),
    app,
    manage: app && isSeller === true,
  };
}

/** Where a blocked route sends the user, matching the access rules above. */
export function getHomeRoute(
  access: RouteAccess,
): '/restaurants' | '/reset-password' | '/setup-profile' {
  if (access.tabs) return '/restaurants';
  if (access.setupProfile) return '/setup-profile';
  return '/reset-password';
}

/** Where sign-in, setup-profile and a saved password reset land: the Profile tab once signed in. */
export function getPostAuthRoute(
  access: RouteAccess,
): '/profile' | ReturnType<typeof getHomeRoute> {
  if (access.app) return '/profile';
  return getHomeRoute(access);
}
