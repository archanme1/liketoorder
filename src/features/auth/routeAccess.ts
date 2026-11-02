// Which route groups the root layout's Stack.Protected guards allow. UX only — RLS protects data.

export type RouteAccessInput = {
  hasSession: boolean;
  /** A reset code was verified but the new password isn't saved yet. */
  isRecovering: boolean;
};

export type RouteAccess = {
  /** sign-in, sign-up, verify-email, forgot-password */
  signedOutScreens: boolean;
  /** reset-password: signed out, or mid-recovery */
  resetPassword: boolean;
  /** signed-in app screens (home) */
  app: boolean;
};

export function getRouteAccess({ hasSession, isRecovering }: RouteAccessInput): RouteAccess {
  return {
    signedOutScreens: !hasSession && !isRecovering,
    resetPassword: !hasSession || isRecovering,
    app: hasSession && !isRecovering,
  };
}
