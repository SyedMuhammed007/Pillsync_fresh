import { useState, useEffect, useCallback, useMemo } from 'react';
import { authApi } from '../api/auth';
import { apiClient } from '../api/client';
import { AuthContext } from './AuthContextValue';
import { decodeJWT, isTokenExpired, generateJWT } from '../utils/jwt';

function getStoredUser() {
  const token = localStorage.getItem('accessToken');
  const storedUser = localStorage.getItem('user');

  if (!token || isTokenExpired(token)) {
    if (storedUser && !token) {
      try {
        return JSON.parse(storedUser);
      } catch {
        return null;
      }
    }
    return null;
  }

  if (storedUser) {
    try {
      return JSON.parse(storedUser);
    } catch {
      localStorage.removeItem('user');
    }
  }

  const decoded = decodeJWT(token);
  if (decoded) {
    return {
      id: decoded.id || decoded.sub,
      email: decoded.email,
      name: decoded.name,
      role: decoded.role || 'patient',
    };
  }

  return null;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser);
  const [loading, setLoading] = useState(false);

  // Synchronize permanent database users so accounts are preserved across any URL or tunnel
  useEffect(() => {
    const syncUsers = async () => {
      try {
        const res = await apiClient.get('/auth/users/');
        if (Array.isArray(res.data) && res.data.length > 0) {
          const raw = localStorage.getItem('pillsync_registered_users');
          const localUsers = raw ? JSON.parse(raw) : [];
          const merged = Array.isArray(localUsers) ? [...localUsers] : [];
          for (const dbUser of res.data) {
            const exists = merged.some(
              (u) => u.email && dbUser.email && u.email.toLowerCase() === dbUser.email.toLowerCase()
            );
            if (!exists) {
              merged.push({
                id: dbUser.id,
                email: dbUser.email,
                name: dbUser.name,
                role: dbUser.role,
                assignedCaregiver: dbUser.assignedCaregiver || 'Caregiver Clinician',
              });
            }
          }
          localStorage.setItem('pillsync_registered_users', JSON.stringify(merged));
        }
      } catch (e) {
        console.warn('User sync on startup error:', e);
      }
    };
    syncUsers();
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch (err) {
      console.warn('Logout request completed with local cleanup:', err);
    } finally {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      setUser(null);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token && isTokenExpired(token)) {
      logout();
    }
  }, [logout]);

  const login = useCallback(async (email, password, role = null) => {
    setLoading(true);
    try {
      const data = await authApi.login(email, password, role);

      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('user', JSON.stringify(data.user));

      setUser(data.user);
      return data;
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (data) => {
    setLoading(true);
    try {
      const result = await authApi.register(data);

      localStorage.setItem('accessToken', result.accessToken);
      localStorage.setItem('refreshToken', result.refreshToken);
      localStorage.setItem('user', JSON.stringify(result.user));

      setUser(result.user);
      return result;
    } finally {
      setLoading(false);
    }
  }, []);

  const forgotPassword = useCallback((email) => authApi.forgotPassword(email), []);

  const resetPassword = useCallback(
    (token, newPassword) => authApi.resetPassword(token, newPassword),
    []
  );

  const switchRole = useCallback(
    (role) => {
      let updatedUser = { ...user };
      if (role === 'patient') {
        updatedUser = {
          id: 'u-patient-1',
          email: 'patient@example.com',
          name: 'Patient Account',
          role: 'patient',
          avatar: null,
        };
      } else if (role === 'caregiver') {
        updatedUser = {
          id: 'u-caregiver-1',
          email: 'caregiver@example.com',
          name: 'Caregiver Clinician',
          role: 'caregiver',
          avatar: null,
        };
      } else if (role === 'admin') {
        updatedUser = {
          id: 'u-admin-1',
          email: 'admin@example.com',
          name: 'Platform Administrator',
          role: 'admin',
          avatar: null,
        };
      }

      const newToken = generateJWT(
        {
          sub: updatedUser.id,
          id: updatedUser.id,
          email: updatedUser.email,
          name: updatedUser.name,
          role: updatedUser.role,
        },
        86400
      );

      localStorage.setItem('accessToken', newToken);
      localStorage.setItem('user', JSON.stringify(updatedUser));
      setUser(updatedUser);
    },
    [user]
  );

  const updateUser = useCallback((updatedFields) => {
    setUser((prevUser) => {
      if (!prevUser) return null;
      const updated = { ...prevUser, ...updatedFields };
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user),
      login,
      register,
      logout,
      forgotPassword,
      resetPassword,
      switchRole,
      updateUser,
    }),
    [user, loading, login, register, logout, forgotPassword, resetPassword, switchRole, updateUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
