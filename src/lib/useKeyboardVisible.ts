import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Whether the on-screen keyboard is up. iOS announces it before it slides in (Will), Android only
 * after (Did), so each uses the earlier event it has.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const shown = Keyboard.addListener(show, () => setVisible(true));
    const hidden = Keyboard.addListener(hide, () => setVisible(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return visible;
}
