import { create } from "zustand";

/**
 * Authentication store using the global auth pattern.
 *
 * Auth model:
 * - SITE_PASSWORD: Optional shared password for all users (if configured)
 * - Username: Honor-system identification for audit logging
 *
 * Storage:
 * - sitePassword: Stored in localStorage, sent via X-Site-Password header
 * - username: Stored in localStorage, sent via X-Username header
 * - userId/role: From backend user record (auto-created on first login)
 */
interface AuthState {
  userId: number | null;
  username: string | null;
  role: string | null;
  sitePassword: string | null;
  isAuthenticated: boolean;
  login: (
    userId: number,
    username: string,
    sitePassword?: string,
    role?: string
  ) => void;
  logout: () => void;
  setUserId: (userId: number) => void;
  setRole: (role: string) => void;
  setSitePassword: (password: string) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  userId: localStorage.getItem("userId")
    ? parseInt(localStorage.getItem("userId")!, 10)
    : null,
  username: localStorage.getItem("username"),
  role: localStorage.getItem("userRole"),
  sitePassword: localStorage.getItem("sitePassword"),
  isAuthenticated: !!localStorage.getItem("username"),

  login: (
    userId: number,
    username: string,
    sitePassword?: string,
    role?: string
  ) => {
    localStorage.setItem("userId", String(userId));
    localStorage.setItem("username", username);
    if (sitePassword) {
      localStorage.setItem("sitePassword", sitePassword);
    }
    if (role) {
      localStorage.setItem("userRole", role);
    }
    set({
      userId,
      username,
      sitePassword: sitePassword || null,
      role: role || null,
      isAuthenticated: true,
    });
  },

  logout: () => {
    localStorage.removeItem("userId");
    localStorage.removeItem("username");
    localStorage.removeItem("userRole");
    localStorage.removeItem("sitePassword");
    set({
      userId: null,
      username: null,
      role: null,
      sitePassword: null,
      isAuthenticated: false,
    });
  },

  setUserId: (userId: number) => {
    localStorage.setItem("userId", String(userId));
    set({ userId });
  },

  setRole: (role: string) => {
    localStorage.setItem("userRole", role);
    set({ role });
  },

  setSitePassword: (password: string) => {
    localStorage.setItem("sitePassword", password);
    set({ sitePassword: password });
  },
}));
