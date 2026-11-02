import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { supabase } from '@/lib/supabase';

import { readRecoveryFlag, writeRecoveryFlag } from '../recoveryFlag';

export type AuthNotice = 'password-updated';

export type AuthContextValue = {
  session: Session | null;
  isLoading: boolean;
  /** A reset code was verified but the new password isn't saved: not treated as signed in. */
  isRecovering: boolean;
  /** One-time message for the next signed-in screen. */
  notice: AuthNotice | null;
  /** Persist the flag before verifying a reset code, so a kill mid-verify still lands on reset. */
  prepareRecovery: () => Promise<void>;
  /** Undo prepareRecovery when the code is rejected. */
  abandonRecovery: () => Promise<void>;
  markRecovering: () => Promise<void>;
  clearRecovering: (notice?: AuthNotice) => Promise<void>;
  dismissNotice: () => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

type AuthState = {
  session: Session | null;
  isLoading: boolean;
  isRecovering: boolean;
  notice: AuthNotice | null;
};

const initialState: AuthState = {
  session: null,
  isLoading: true,
  isRecovering: false,
  notice: null,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>(initialState);
  const recoveringRef = useRef(false);

  useEffect(() => {
    recoveringRef.current = state.isRecovering;
  }, [state.isRecovering]);

  useEffect(() => {
    let active = true;

    // Don't await other supabase calls inside this callback (supabase-js can deadlock).
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY') {
        // Session and flag in one update, so the guard never sees a recovery session as signed in.
        void writeRecoveryFlag(true);
        setState((prev) => ({ ...prev, session, isRecovering: true }));
        return;
      }
      if (event === 'SIGNED_OUT') {
        void writeRecoveryFlag(false);
        queryClient.clear();
        setState((prev) => ({ ...prev, session: null, isRecovering: false, notice: null }));
        return;
      }
      setState((prev) => ({ ...prev, session }));
    });

    void Promise.all([supabase.auth.getSession(), readRecoveryFlag()]).then(
      ([{ data: sessionData }, storedRecovering]) => {
        if (!active) return;
        const session = sessionData.session;
        // A flag without a session is stale (e.g. killed mid-verify with a wrong code).
        if (storedRecovering && !session) void writeRecoveryFlag(false);
        setState((prev) => ({
          ...prev,
          session,
          isRecovering: prev.isRecovering || (storedRecovering && session !== null),
          isLoading: false,
        }));
      },
    );

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [queryClient]);

  const prepareRecovery = useCallback(() => writeRecoveryFlag(true), []);

  const abandonRecovery = useCallback(async () => {
    if (!recoveringRef.current) await writeRecoveryFlag(false);
  }, []);

  const markRecovering = useCallback(async () => {
    await writeRecoveryFlag(true);
    setState((prev) => ({ ...prev, isRecovering: true }));
  }, []);

  const clearRecovering = useCallback(async (notice?: AuthNotice) => {
    await writeRecoveryFlag(false);
    setState((prev) => ({ ...prev, isRecovering: false, notice: notice ?? prev.notice }));
  }, []);

  const dismissNotice = useCallback(() => {
    setState((prev) => ({ ...prev, notice: null }));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      prepareRecovery,
      abandonRecovery,
      markRecovering,
      clearRecovering,
      dismissNotice,
    }),
    [state, prepareRecovery, abandonRecovery, markRecovering, clearRecovering, dismissNotice],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
