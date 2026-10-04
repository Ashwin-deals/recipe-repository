import { createContext, useContext } from "react";
import type { Credentials } from "../api/endpoints";
import type { User } from "../types";

export interface SignInOptions {
  celebrate?: () => Promise<void>;
}

export interface AuthApi {
  /** "loading" until the first /api/auth/me answers, so nothing flickers between screens. */
  status: "loading" | "ready";
  user: User | null;
  /** Shown on the sign-in page once, e.g. after the session expired. */
  notice: string | null;
  /** Set right after sign-up so the dashboard can show the welcome. */
  isNewAccount: boolean;
  /** `celebrate` runs after the server accepts and before the app opens (the button's success tick). */
  login: (credentials: Credentials, options?: SignInOptions) => Promise<User>;
  signup: (credentials: Credentials, options?: SignInOptions) => Promise<User>;
  demo: () => Promise<User>;
  logout: () => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  dismissWelcome: () => void;
}

export const AuthContext = createContext<AuthApi | null>(null);

export function useAuth(): AuthApi {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
