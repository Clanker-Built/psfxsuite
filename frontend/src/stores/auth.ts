import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type UserRole = 'admin' | 'operator' | 'auditor';

export interface User {
  id: number;
  username: string;
  email: string;
  role: UserRole;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  // Token is now stored in httpOnly cookie, not in client state
  login: (user: User) => void;
  logout: () => void;
  hasRole: (roles: UserRole[]) => boolean;
  canEdit: () => boolean;
  canAcknowledge: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,

      login: (user) => {
        // Token is stored in httpOnly cookie by backend
        set({ user, isAuthenticated: true });
      },

      logout: () => {
        set({ user: null, isAuthenticated: false });
      },

      hasRole: (roles) => {
        const { user } = get();
        return user ? roles.includes(user.role) : false;
      },

      canEdit: () => {
        const { user } = get();
        return user?.role === 'admin';
      },

      canAcknowledge: () => {
        const { user } = get();
        return user ? ['admin', 'operator'].includes(user.role) : false;
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        // Token no longer persisted - stored as httpOnly cookie
      }),
    }
  )
);
