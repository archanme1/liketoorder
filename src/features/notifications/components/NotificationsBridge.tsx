import { useEffect } from 'react';

import { useForegroundRefresh } from '../hooks/useForegroundRefresh';
import { useNotificationTaps } from '../hooks/useNotificationTaps';
import { usePrimerOpener } from '../hooks/usePrimerMoment';
import { usePushRegistration } from '../hooks/usePushRegistration';
import { useSubmitPrimerWatcher } from '../hooks/useSubmitPrimerWatcher';
import { configureForegroundHandler, ensureAndroidChannel } from '../pushModule';

// Mounted once in the root layout, after the first route has rendered, so it can navigate. It
// renders nothing: the foreground banner and refresh, the Android channel, token registration,
// tap routing and the primer moments.
export function NotificationsBridge() {
  useEffect(() => {
    configureForegroundHandler();
    void ensureAndroidChannel();
  }, []);
  usePushRegistration();
  useNotificationTaps();
  useForegroundRefresh();
  useSubmitPrimerWatcher();
  usePrimerOpener();
  return null;
}
