import { cleanup, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AuthContext, type AuthContextValue } from '../components/AuthProvider';
import { useClearReturnToOnLeave } from '../hooks/useClearReturnToOnLeave';
import { clearReturnTo, peekReturnTo, requestFormHref, setReturnTo } from '../returnTo';

const ID = '11111111-1111-4111-8111-111111111111';
const session = { user: { id: 'u1' } } as unknown as AuthContextValue['session'];

function auth(signedIn: boolean): AuthContextValue {
  return {
    session: signedIn ? session : null,
    isLoading: false,
    isRecovering: false,
    notice: null,
    prepareRecovery: jest.fn(),
    abandonRecovery: jest.fn(),
    markRecovering: jest.fn(),
    clearRecovering: jest.fn(),
    dismissNotice: jest.fn(),
  };
}

async function setup(initial: AuthContextValue) {
  let value = initial;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
  const view = await renderHook(() => useClearReturnToOnLeave(), { wrapper });
  return {
    ...view,
    setSession: (next: AuthContextValue) => {
      value = next;
    },
  };
}

beforeEach(() => {
  clearReturnTo();
  setReturnTo(requestFormHref(ID));
});
afterEach(async () => {
  await cleanup();
  clearReturnTo();
});

describe('useClearReturnToOnLeave', () => {
  it('keeps the return while the sign-in screens are open', async () => {
    await setup(auth(false));
    expect(peekReturnTo()).toBe(requestFormHref(ID));
  });

  it('forgets it when the sign-in screens go away with no session (swipe back, hardware back)', async () => {
    const view = await setup(auth(false));
    await view.unmount();
    expect(peekReturnTo()).toBeNull();
  });

  it('keeps it when they go away because the person signed in (the navigator uses it next)', async () => {
    const view = await setup(auth(false));
    view.setSession(auth(true));
    await view.rerender(undefined);
    await view.unmount();
    expect(peekReturnTo()).toBe(requestFormHref(ID));
  });
});
