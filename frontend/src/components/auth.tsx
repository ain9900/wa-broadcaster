import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setUnauthorizedHandler } from '../lib/api';
import type { User } from '../lib/types';

type AuthState = {
  user: User | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthCtx = createContext<AuthState>(null!);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    setUnauthorizedHandler(() => { setUser(null); qc.clear(); });
    // Also sets the CSRF cookie that every later POST needs.
    api<{ user: User | null }>('/auth/session/')
      .then(r => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, [qc]);

  const login = useCallback(async (username: string, password: string) => {
    const r = await api<{ user: User }>('/auth/login/', { method: 'POST', body: { username, password } });
    // Django rotates the CSRF token on login; fetch the fresh one.
    await api('/auth/session/');
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout/', { method: 'POST' }).catch(() => {});
    qc.clear();
    setUser(null);
  }, [qc]);

  return <AuthCtx.Provider value={{ user, ready, login, logout }}>{children}</AuthCtx.Provider>;
}
