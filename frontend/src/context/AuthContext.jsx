import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setAuthToken } from '../lib/api';

const AuthContext = createContext(null);
const STORAGE_KEY = 'eapis.session';

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (session?.token) setAuthToken(session.token);
    setReady(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (username, password) => {
    const result = await api.post('/auth/login', { username, password });
    setAuthToken(result.token);
    const next = { token: result.token, user: result.user };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
    return next;
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }, []);

  const value = {
    user: session?.user ?? null,
    token: session?.token ?? null,
    isAuthenticated: !!session?.token,
    ready,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}