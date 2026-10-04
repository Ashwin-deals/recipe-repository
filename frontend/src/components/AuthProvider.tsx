import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { onUnauthorized, setCsrfToken, ApiError } from "../api/client";
import {
  deleteAccount as apiDeleteAccount, getMe, signIn, signInDemo, signOut, signUp, type Credentials,
} from "../api/endpoints";
import { AuthContext, type AuthApi, type SignInOptions } from "../hooks/useAuth";
import { claimDeviceData, clearUserData } from "../lib/session";
import type { AuthResult, User } from "../types";

export const SESSION_EXPIRED = "Your session expired. Please sign in again.";
const LAST_USER_KEY = "cartchef:last-user";

/** The last signed-in user, so the app can open offline. Removed on sign-out with the rest. */
function rememberedUser(): User | null {
  try {
    const raw = localStorage.getItem(LAST_USER_KEY);
    const user = raw ? (JSON.parse(raw) as Partial<User>) : null;
    return user && typeof user.id === "number" && typeof user.email === "string" ? (user as User) : null;
  } catch {
    return null;
  }
}

function remember(user: User): void {
  try {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
  } catch {
    // Storage blocked: the app just won't open offline.
  }
}

/** Who is signed in. Data providers sit below this and are remounted per user (see App.tsx). */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthApi["status"]>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isNewAccount, setIsNewAccount] = useState(false);
  const userRef = useRef<User | null>(null);

  const becomeSignedOut = useCallback(async (message: string | null) => {
    userRef.current = null;
    await clearUserData();
    setUser(null);
    setIsNewAccount(false);
    setNotice(message);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then(async ({ user: me, csrf_token }) => {
        setCsrfToken(csrf_token);
        if (me) {
          await claimDeviceData(me.id);
          remember(me);
        } else {
          await clearUserData();
        }
        if (cancelled) return;
        userRef.current = me;
        setUser(me);
      })
      .catch((err: unknown) => {
        // Offline: open as the last user on this device (their data is in the offline cache).
        const offline = err instanceof ApiError && err.offline ? rememberedUser() : null;
        if (!cancelled) {
          userRef.current = offline;
          setUser(offline);
        }
      })
      .finally(() => {
        if (!cancelled) setStatus("ready");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    onUnauthorized(() => {
      if (userRef.current) void becomeSignedOut(SESSION_EXPIRED);
    });
    return () => onUnauthorized(null);
  }, [becomeSignedOut]);

  const signedIn = useCallback(async (result: AuthResult, isNew: boolean, options: SignInOptions = {}) => {
    setCsrfToken(result.csrf_token);
    await options.celebrate?.();
    // Whatever this device held before belongs to someone else (or to an older session).
    await clearUserData();
    await claimDeviceData(result.user.id);
    remember(result.user);
    userRef.current = result.user;
    setNotice(null);
    setIsNewAccount(isNew);
    setUser(result.user);
    return result.user;
  }, []);

  const login = useCallback(
    async (credentials: Credentials, options?: SignInOptions) => signedIn(await signIn(credentials), false, options),
    [signedIn],
  );
  const signup = useCallback(
    async (credentials: Credentials, options?: SignInOptions) => signedIn(await signUp(credentials), true, options),
    [signedIn],
  );
  const demo = useCallback(async () => signedIn(await signInDemo(), false), [signedIn]);

  const logout = useCallback(async () => {
    try {
      const result = await signOut();
      setCsrfToken(result.csrf_token);
    } catch {
      // Offline or already signed out: still forget everything on this device.
      setCsrfToken(null);
    }
    await becomeSignedOut(null);
  }, [becomeSignedOut]);

  const deleteAccount = useCallback(
    async (password: string) => {
      const result = await apiDeleteAccount(password);
      setCsrfToken(result.csrf_token);
      await becomeSignedOut("Your account and everything in it has been deleted.");
    },
    [becomeSignedOut],
  );

  const dismissWelcome = useCallback(() => setIsNewAccount(false), []);

  const value = useMemo<AuthApi>(
    () => ({ status, user, notice, isNewAccount, login, signup, demo, logout, deleteAccount, dismissWelcome }),
    [status, user, notice, isNewAccount, login, signup, demo, logout, deleteAccount, dismissWelcome],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
