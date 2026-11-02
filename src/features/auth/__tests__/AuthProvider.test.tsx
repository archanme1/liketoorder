import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { supabase } from '@/lib/supabase';

import { AuthProvider } from '../components/AuthProvider';
import { ResetPasswordForm } from '../components/ResetPasswordForm';
import { useSession } from '../hooks/useSession';
import { getRouteAccess } from '../routeAccess';

const RECOVERY_KEY = 'liketoorder.auth.isRecovering';
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: jest.fn(),
      getSession: jest.fn(),
      verifyOtp: jest.fn(),
      updateUser: jest.fn(),
      signOut: jest.fn(),
    },
  },
}));

const auth = supabase.auth as unknown as Record<string, jest.Mock>;
const session = { access_token: 't', refresh_token: 'r', user: { id: 'u1' } };

type Listener = (event: string, session: unknown) => void;
let listener: Listener;
let unsubscribe: jest.Mock;
let client: QueryClient;

function Probe() {
  const ctx = useSession();
  const access = getRouteAccess({ hasSession: !!ctx.session, isRecovering: ctx.isRecovering });
  return (
    <>
      <Text>{`loading:${ctx.isLoading}`}</Text>
      <Text>{`session:${ctx.session ? 'yes' : 'no'}`}</Text>
      <Text>{`recovering:${ctx.isRecovering}`}</Text>
      <Text>{`access:${JSON.stringify(access)}`}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="mark"
        onPress={ctx.markRecovering}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="clear"
        onPress={() => ctx.clearRecovering()}
      />
    </>
  );
}

async function mount(children: React.ReactNode = <Probe />) {
  await render(
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>,
  );
}

async function emit(event: string, value: unknown) {
  await act(async () => {
    listener(event, value);
  });
}

describe('getRouteAccess', () => {
  it.each([
    [false, false, { signedOutScreens: true, resetPassword: true, app: false }],
    [true, false, { signedOutScreens: false, resetPassword: false, app: true }],
    [true, true, { signedOutScreens: false, resetPassword: true, app: false }],
    [false, true, { signedOutScreens: false, resetPassword: true, app: false }],
  ])('hasSession=%s isRecovering=%s', (hasSession, isRecovering, expected) => {
    expect(getRouteAccess({ hasSession, isRecovering })).toEqual(expected);
  });
});

describe('AuthProvider', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    client = new QueryClient({
      // gcTime Infinity: no cache-cleanup timers left running after a test.
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    });
    unsubscribe = jest.fn();
    auth.onAuthStateChange.mockImplementation((cb: Listener) => {
      listener = cb;
      return { data: { subscription: { unsubscribe } } };
    });
    auth.getSession.mockResolvedValue({ data: { session: null } });
    auth.verifyOtp.mockResolvedValue({ data: { session, user: session.user }, error: null });
    auth.updateUser.mockResolvedValue({ data: { user: session.user }, error: null });
    auth.signOut.mockImplementation(async () => {
      await act(async () => {
        listener('SIGNED_OUT', null);
      });
      return { error: null };
    });
  });

  it('is loading until the session and stored flag have resolved', async () => {
    let resolveSession: (v: unknown) => void = () => {};
    auth.getSession.mockReturnValue(new Promise((r) => (resolveSession = r)));
    await mount();
    expect(screen.getByText('loading:true')).toBeTruthy();
    await act(async () => {
      resolveSession({ data: { session } });
    });
    expect(await screen.findByText('loading:false')).toBeTruthy();
    expect(screen.getByText('session:yes')).toBeTruthy();
  });

  it('starts signed out and not recovering with no session', async () => {
    await mount();
    expect(await screen.findByText('loading:false')).toBeTruthy();
    expect(screen.getByText('session:no')).toBeTruthy();
    expect(screen.getByText('recovering:false')).toBeTruthy();
  });

  it('unsubscribes from auth changes on unmount', async () => {
    await mount();
    await screen.findByText('loading:false');
    await screen.unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('throws when useSession is used outside the provider', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    function Bare() {
      useSession();
      return null;
    }
    await expect(async () => {
      await render(<Bare />);
    }).rejects.toThrow();
    spy.mockRestore();
  });

  describe('recovery session', () => {
    it('PASSWORD_RECOVERY sets the session, isRecovering, persists the flag and allows only reset-password', async () => {
      await mount();
      await screen.findByText('loading:false');
      await emit('PASSWORD_RECOVERY', session);
      expect(screen.getByText('session:yes')).toBeTruthy();
      expect(screen.getByText('recovering:true')).toBeTruthy();
      expect(await AsyncStorage.getItem(RECOVERY_KEY)).toBe('true');
      expect(
        screen.getByText(
          `access:${JSON.stringify({ signedOutScreens: false, resetPassword: true, app: false })}`,
        ),
      ).toBeTruthy();
    });

    it('a normal sign-in is not recovering and reaches the app', async () => {
      await mount();
      await screen.findByText('loading:false');
      await emit('SIGNED_IN', session);
      expect(screen.getByText('recovering:false')).toBeTruthy();
      expect(
        screen.getByText(
          `access:${JSON.stringify({ signedOutScreens: false, resetPassword: false, app: true })}`,
        ),
      ).toBeTruthy();
    });

    it('the flag survives a remount when a session exists', async () => {
      await mount();
      await screen.findByText('loading:false');
      await emit('PASSWORD_RECOVERY', session);
      await screen.unmount();

      auth.getSession.mockResolvedValue({ data: { session } });
      await mount();
      expect(await screen.findByText('loading:false')).toBeTruthy();
      expect(screen.getByText('recovering:true')).toBeTruthy();
      expect(screen.getByText('session:yes')).toBeTruthy();
    });

    it('a stored flag without a session is cleared on launch', async () => {
      await AsyncStorage.setItem(RECOVERY_KEY, 'true');
      await mount();
      expect(await screen.findByText('loading:false')).toBeTruthy();
      expect(screen.getByText('recovering:false')).toBeTruthy();
      await waitFor(async () => expect(await AsyncStorage.getItem(RECOVERY_KEY)).toBeNull());
    });

    it('markRecovering sets and persists; clearRecovering resets and removes', async () => {
      await mount();
      await screen.findByText('loading:false');
      await fireEvent.press(screen.getByRole('button', { name: 'mark' }));
      expect(await screen.findByText('recovering:true')).toBeTruthy();
      await waitFor(async () => expect(await AsyncStorage.getItem(RECOVERY_KEY)).toBe('true'));
      await fireEvent.press(screen.getByRole('button', { name: 'clear' }));
      expect(await screen.findByText('recovering:false')).toBeTruthy();
      expect(screen.getByText('recovering:false')).toBeTruthy();
      await waitFor(async () => expect(await AsyncStorage.getItem(RECOVERY_KEY)).toBeNull());
    });

    it('SIGNED_OUT clears session, flag and the query cache', async () => {
      await mount();
      await screen.findByText('loading:false');
      client.setQueryData(['profile', 'me'], { username: 'archan' });
      await emit('PASSWORD_RECOVERY', session);
      await emit('SIGNED_OUT', null);
      expect(screen.getByText('session:no')).toBeTruthy();
      expect(screen.getByText('recovering:false')).toBeTruthy();
      expect(await AsyncStorage.getItem(RECOVERY_KEY)).toBeNull();
      expect(client.getQueryData(['profile', 'me'])).toBeUndefined();
    });
  });

  describe('reset flow end to end (supabase mocked)', () => {
    async function verifyCode() {
      await fireEvent.changeText(await screen.findByLabelText('Reset code'), '123456');
      await fireEvent.press(screen.getByRole('button', { name: 'Verify' }));
      await screen.findByLabelText('New password');
    }

    it('a successful verifyResetCode makes isRecovering true and the guard only allows reset-password', async () => {
      await mount(
        <>
          <Probe />
          <ResetPasswordForm email="a@b.com" />
        </>,
      );
      await verifyCode();
      expect(auth.verifyOtp).toHaveBeenCalledWith({
        email: 'a@b.com',
        token: '123456',
        type: 'recovery',
      });
      await waitFor(() => expect(screen.getByText('recovering:true')).toBeTruthy());
      expect(
        screen.getByText(
          `access:${JSON.stringify({ signedOutScreens: false, resetPassword: true, app: false })}`,
        ),
      ).toBeTruthy();
      expect(await AsyncStorage.getItem(RECOVERY_KEY)).toBe('true');
    });

    it('a successful updatePassword clears isRecovering and reaches the app', async () => {
      await mount(
        <>
          <Probe />
          <ResetPasswordForm email="a@b.com" />
        </>,
      );
      await verifyCode();
      await emit('PASSWORD_RECOVERY', session);
      await fireEvent.changeText(screen.getByLabelText('New password'), 'abcdefg1');
      await fireEvent.changeText(screen.getByLabelText('Confirm new password'), 'abcdefg1');
      await fireEvent.press(screen.getByRole('button', { name: 'Save password' }));
      await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ password: 'abcdefg1' }));
      await waitFor(() => expect(screen.getByText('recovering:false')).toBeTruthy());
      expect(screen.getByText('session:yes')).toBeTruthy();
      expect(await AsyncStorage.getItem(RECOVERY_KEY)).toBeNull();
      expect(
        screen.getByText(
          `access:${JSON.stringify({ signedOutScreens: false, resetPassword: false, app: true })}`,
        ),
      ).toBeTruthy();
    });

    it('Cancel signs out and clears isRecovering', async () => {
      await mount(
        <>
          <Probe />
          <ResetPasswordForm email="a@b.com" />
        </>,
      );
      await verifyCode();
      await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByText('recovering:false')).toBeTruthy());
      expect(screen.getByText('session:no')).toBeTruthy();
      expect(await AsyncStorage.getItem(RECOVERY_KEY)).toBeNull();
    });
  });
});
