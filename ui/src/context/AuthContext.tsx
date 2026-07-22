import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { api, getStoredToken, getStoredUser, storeAuth, clearAuth, AuthUser } from "../api/client";

interface AuthContextType {
  isAuthenticated: boolean;
  user: AuthUser | null;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<string | null>;
  register: (username: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  user: null,
  isAdmin: false,
  login: async () => null,
  register: async () => null,
  logout: async () => {},
  loading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore auth state from localStorage on mount
  useEffect(() => {
    const token = getStoredToken();
    const storedUser = getStoredUser();
    if (token && storedUser) {
      setUser(storedUser);
    }
    setLoading(false);

    // Listen for forced logout events (e.g., 401 from API)
    const handleForceLogout = () => {
      setUser(null);
    };
    window.addEventListener("auth:logout", handleForceLogout);
    return () => window.removeEventListener("auth:logout", handleForceLogout);
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<string | null> => {
    const res = await api.login(username, password);
    if (res.success && res.data) {
      const { token, username: uname, role } = res.data;
      const authUser: AuthUser = { username: uname, role };
      storeAuth(token, authUser);
      setUser(authUser);
      return null; // no error
    }
    return res.error ?? "Login failed";
  }, []);

  const register = useCallback(async (username: string, password: string): Promise<string | null> => {
    const res = await api.register(username, password);
    if (res.success && res.data) {
      const { token, username: uname, role } = res.data;
      const authUser: AuthUser = { username: uname, role };
      storeAuth(token, authUser);
      setUser(authUser);
      return null; // no error
    }
    return res.error ?? "Registration failed";
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Server logout is best-effort — always clear local state
    }
    clearAuth();
    setUser(null);
  }, []);

  const value: AuthContextType = {
    isAuthenticated: user !== null,
    user,
    isAdmin: user?.role === "admin",
    login,
    register,
    logout,
    loading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  return useContext(AuthContext);
}


