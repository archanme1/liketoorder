// Which route groups the root layout's Stack.Protected guards allow. UX only — RLS protects data.

export type RouteAccessInput = {
  hasSession: boolean;
  /** A reset code was verified but the new password isn't saved yet. */
  isRecovering: boolean;
  /** Whether profiles.username is set. Omitted means "not checked" and counts as complete. */
  profileComplete?: boolean;
};

export type RouteAccess = {
  /** sign-in, sign-up, verify-email, forgot-password */
  signedOutScreens: boolean;
  /** reset-password: signed out, or mid-recovery */
  resetPassword: boolean;
  /** setup-profile: signed in, not recovering, username not set yet */
  setupProfile: boolean;
  /** signed-in app screens (home, edit profile) */
  app: boolean;
};

export function getRouteAccess({
  hasSession,
  isRecovering,
  profileComplete,
}: RouteAccessInput): RouteAccess {
  const signedIn = hasSession && !isRecovering;
  return {
    signedOutScreens: !hasSession && !isRecovering,
    resetPassword: !hasSession || isRecovering,
    setupProfile: signedIn && profileComplete === false,
    app: signedIn && profileComplete !== false,
  };
}

/** Where a blocked route sends the user, matching the access rules above. */
export function getHomeRoute(
  access: RouteAccess,
): '/sign-in' | '/reset-password' | '/setup-profile' | '/' {
  if (access.app) return '/';
  if (access.setupProfile) return '/setup-profile';
  if (access.signedOutScreens) return '/sign-in';
  return '/reset-password';
}
