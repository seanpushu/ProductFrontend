import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AuthApiError, authApi, authEnabled, type Profile } from "./api";

type Status = "restoring" | "anonymous" | "signed-in";

type AuthContextValue = {
  status: Status;
  profile: Profile | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reloadProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("restoring");
  const [profile, setProfile] = useState<Profile | null>(null);
  // Access token in memory only (not localStorage / sessionStorage).
  const accessToken = useRef<string | null>(null);

  const signOutLocally = useCallback(() => {
    accessToken.current = null;
    setProfile(null);
    setStatus("anonymous");
  }, []);

  // GET /me; on 401 try /refresh exactly once, then give up and sign out.
  const loadProfile = useCallback(async () => {
    const attempt = async () => {
      if (!accessToken.current) throw new AuthApiError("Not signed in", 401, "UNAUTHENTICATED");
      return authApi.me(accessToken.current);
    };
    try {
      setProfile(await attempt());
    } catch (err) {
      if (!(err instanceof AuthApiError) || err.status !== 401) throw err;
      try {
        accessToken.current = (await authApi.refresh()).access_token;
      } catch {
        signOutLocally();
        return;
      }
      setProfile(await attempt());
    }
    setStatus("signed-in");
  }, [signOutLocally]);

  // On page load: restore the session from the HttpOnly refresh cookie, once.
  useEffect(() => {
    if (!authEnabled()) return;
    let cancelled = false;
    authApi
      .refresh()
      .then(async (t) => {
        if (cancelled) return;
        accessToken.current = t.access_token;
        await loadProfile();
      })
      .catch(() => {
        if (!cancelled) signOutLocally();
      });
    return () => {
      cancelled = true;
    };
  }, [loadProfile, signOutLocally]);

  const login = useCallback(
    async (email: string, password: string) => {
      const t = await authApi.login(email, password);
      accessToken.current = t.access_token;
      await loadProfile();
    },
    [loadProfile],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      signOutLocally();
    }
  }, [signOutLocally]);

  const value = useMemo(
    () => ({ status, profile, login, logout, reloadProfile: loadProfile }),
    [status, profile, login, logout, loadProfile],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
