import { useEffect } from 'react';

import { usePrimerOpener } from '../hooks/usePrimerMoment';
import { usePushRegistration } from '../hooks/usePushRegistration';
import { useSubmitPrimerWatcher } from '../hooks/useSubmitPrimerWatcher';
import { configureForegroundHandler, ensureAndroidChannel } from '../pushModule';

// Mounted once in the root layout, after the first route has rendered, so it can navigate. It
// renders nothing: the foreground banner, the Android channel, token registration and the primer
// moments. (Tap routing and the foreground refresh join in gate G.)
export function NotificationsBridge() {
  useEffect(() => {
    configureForegroundHandler();
    void ensureAndroidChannel();
  }, []);
  usePushRegistration();
  useSubmitPrimerWatcher();
  usePrimerOpener();
  return null;
}
