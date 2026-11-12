export const notificationKeys = {
  all: ['notifications'] as const,
  /** The phone's permission: not a server read, but shared by every screen that shows it. */
  permission: ['notifications', 'permission'] as const,
  settings: ['notifications', 'settings'] as const,
};
