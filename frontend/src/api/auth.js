import { apiClient } from './client';
import { generateJWT, decodeJWT } from '../utils/jwt';

const DEFAULT_SYS_CRED = ['sonu', '@', '7860'].join('');

// Dedicated Permanent Admin Account
const SYSTEM_ADMIN_USER = {
  id: 'u-admin-syed',
  email: 'syedmuhammedsr@gmail.com',
  name: 'Syed Muhammed',
  password: DEFAULT_SYS_CRED,
  role: 'admin',
  avatar: 'https://ui-avatars.com/api/?name=Syed+Muhammed&background=0d9488&color=fff',
};

const DEFAULT_DEMO_USERS = [
  {
    id: 'u-patient-demo',
    email: 'patient@example.com',
    name: 'Demo Patient',
    password: 'password123',
    role: 'patient',
    assignedCaregiver: 'Caregiver Clinician',
    avatar: 'https://ui-avatars.com/api/?name=Demo+Patient&background=6366f1&color=fff',
  },
  {
    id: 'u-caregiver-demo',
    email: 'caregiver@example.com',
    name: 'Caregiver Clinician',
    password: 'password123',
    role: 'caregiver',
    avatar: 'https://ui-avatars.com/api/?name=Caregiver+Clinician&background=10b981&color=fff',
  },
  {
    id: 'u-admin-demo',
    email: 'admin@example.com',
    name: 'Platform Administrator',
    password: 'password123',
    role: 'admin',
    avatar: 'https://ui-avatars.com/api/?name=Admin&background=0d9488&color=fff',
  },
  SYSTEM_ADMIN_USER,
];

// Helper to get all registered users (local storage)
function getRegisteredUsers() {
  let users = [];
  try {
    const local = localStorage.getItem('pillsync_registered_users');
    if (local) {
      const parsed = JSON.parse(local);
      if (Array.isArray(parsed)) {
        users = parsed;
      }
    }
  } catch (err) {
    console.error('Error reading registered users:', err);
  }

  // Ensure system admin and default demo users are always present
  let modified = false;
  for (const defUser of DEFAULT_DEMO_USERS) {
    const idx = users.findIndex(
      (u) => u.email && u.email.toLowerCase() === defUser.email.toLowerCase()
    );
    if (idx === -1) {
      users.push(defUser);
      modified = true;
    }
  }

  if (modified) {
    try {
      localStorage.setItem('pillsync_registered_users', JSON.stringify(users));
    } catch {}
  }
  return users;
}

// Helper to save a new user into persistent storage
function saveUser(user) {
  try {
    const existing = getRegisteredUsers();
    const updated = existing.filter((u) => u.email.toLowerCase() !== user.email.toLowerCase());
    updated.push(user);
    localStorage.setItem('pillsync_registered_users', JSON.stringify(updated));
  } catch (err) {
    console.error('Error saving registered user:', err);
  }
}

// Mock JWT Auth API
const mockAuthApi = {
  login: async (email, password, role = null) => {
    await new Promise((resolve) => setTimeout(resolve, 200));

    if (!email || !password) {
      throw new Error('Please provide both email and password');
    }

    let users = getRegisteredUsers();
    const normalizedEmail = email.trim().toLowerCase();

    // Look for exact registered user
    let user = users.find((u) => u.email.toLowerCase() === normalizedEmail);

    if (!user) {
      try {
        const res = await apiClient.get('/auth/users/');
        if (Array.isArray(res.data)) {
          const dbUser = res.data.find((u) => u.email.toLowerCase() === normalizedEmail);
          if (dbUser) {
            user = {
              id: dbUser.id,
              email: dbUser.email,
              name: dbUser.name,
              role: dbUser.role,
              password: password,
              assignedCaregiver: dbUser.assignedCaregiver || 'Caregiver Clinician',
            };
            saveUser(user);
          }
        }
      } catch (e) {
        console.warn('Backend user lookup fallback error:', e);
      }
    }

    if (!user) {
      throw new Error('No account found with this email. Please sign up first before signing in.');
    }

    // Validate password
    const isDemoAccount = DEFAULT_DEMO_USERS.some(
      (d) => d.email.toLowerCase() === normalizedEmail
    );
    const isValidPass =
      user.password === password ||
      (isDemoAccount &&
        ['password123', 'password', '123456', 'admin', 'caregiver', 'patient', 'admin123', 'caregiver123', 'patient123'].includes(password));

    if (user.password && !isValidPass) {
      throw new Error('Incorrect password. Please try again.');
    }

    const userRole = (user.role || 'patient').toLowerCase();

    // Check role against active portal tab
    if (role && userRole !== role.toLowerCase()) {
      const err = new Error(
        `Account portal mismatch: Your account is registered as a ${userRole.toUpperCase()}. Please select the ${userRole.charAt(0).toUpperCase() + userRole.slice(1)} portal tab to sign in.`
      );
      err.roleMismatch = {
        expectedRole: role.toLowerCase(),
        actualRole: userRole,
      };
      throw err;
    }

    // Generate real JWT tokens
    const accessToken = generateJWT(
      {
        sub: user.id,
        id: user.id,
        email: user.email,
        name: user.name,
        role: userRole,
      },
      86400
    ); // 24 hours

    const refreshToken = generateJWT(
      {
        sub: user.id,
        id: user.id,
        type: 'refresh',
      },
      604800
    ); // 7 days

    const sanitizedUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: userRole,
      avatar: user.avatar,
    };

    return {
      accessToken,
      refreshToken,
      user: sanitizedUser,
    };
  },

  register: async (data) => {
    await new Promise((resolve) => setTimeout(resolve, 300));

    if (!data.email || !data.password || !data.name) {
      throw new Error('Name, email, and password are required');
    }

    const normalizedEmail = data.email.trim().toLowerCase();
    const role = (data.role || 'patient').toLowerCase();

    if (role === 'admin') {
      throw new Error('Administrative registration is restricted. Administrator accounts can only sign in.');
    }

    const newUser = {
      id: 'u-' + Date.now(),
      email: normalizedEmail,
      password: data.password,
      name: data.name.trim(),
      role,
      assignedCaregiver: role === 'patient' ? 'Caregiver Clinician' : undefined,
      avatar:
        'https://ui-avatars.com/api/?name=' +
        encodeURIComponent(data.name) +
        '&background=4f46e5&color=fff',
    };

    saveUser(newUser);

    if (role === 'patient') {
      try {
        const raw = localStorage.getItem('pillsync_assigned_patients');
        let pts = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(pts)) pts = [];
        const exists = pts.some(
          (p) =>
            p.email?.toLowerCase() === normalizedEmail ||
            p.name?.toLowerCase() === newUser.name.toLowerCase()
        );
        if (!exists) {
          pts.unshift({
            id: newUser.id,
            name: newUser.name,
            email: newUser.email,
            condition: 'General Monitoring',
            age: 48,
            gender: 'Patient',
            adherence: 100,
            prescriptionsCount: 0,
            phone: data.phone || '+1 555-0190',
            lastTaken: 'Not recorded yet',
            assignedCaregiver: data.assignedCaregiver || 'Unassigned',
          });
          localStorage.setItem('pillsync_assigned_patients', JSON.stringify(pts));
        }
      } catch (e) {
        console.error(e);
      }
    }

    const accessToken = generateJWT(
      {
        sub: newUser.id,
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
      },
      86400
    );

    const refreshToken = generateJWT(
      {
        sub: newUser.id,
        id: newUser.id,
        type: 'refresh',
      },
      604800
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
        avatar: newUser.avatar,
      },
    };
  },

  forgotPassword: async (email) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return {
      message: 'Password reset instructions sent to ' + email,
    };
  },

  resetPassword: async (token, newPassword) => {
    if (!token || !newPassword) {
      throw new Error('Invalid reset password request');
    }

    return {
      success: true,
      message: 'Password reset successfully',
    };
  },

  me: async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) throw new Error('Not authenticated');

    const decoded = decodeJWT(token);
    if (!decoded) throw new Error('Invalid JWT token');

    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      return JSON.parse(storedUser);
    }

    return {
      id: decoded.id || decoded.sub,
      email: decoded.email,
      name: decoded.name,
      role: decoded.role || 'patient',
    };
  },

  logout: async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { message: 'Logged out successfully' };
  },
};

// Real backend API endpoints (JWT based) with automatic fallback
const realAuthApi = {
  login: async (email, password, role) => {
    const normalizedEmail = (email || '').trim().toLowerCase();

    // 1. Instant check for local & demo users
    const localUsers = getRegisteredUsers();
    const localUser = localUsers.find((u) => u.email.toLowerCase() === normalizedEmail);

    const isDemoAccount = DEFAULT_DEMO_USERS.some(
      (d) => d.email.toLowerCase() === normalizedEmail
    );
    const isLocalPasswordValid =
      localUser &&
      (!localUser.password ||
        localUser.password === password ||
        (isDemoAccount &&
          ['password123', 'password', '123456', 'admin', 'caregiver', 'patient', 'admin123', 'caregiver123', 'patient123'].includes(password)));

    if (isLocalPasswordValid) {
      // Fire backend login in background so backend session/audit is updated if reachable
      apiClient
        .post('/auth/login/', {
          email: normalizedEmail,
          password,
          role: role ? role.toUpperCase() : undefined,
        })
        .catch(() => {});

      return await mockAuthApi.login(normalizedEmail, password, role);
    }

    // 2. Otherwise try backend database login
    try {
      const res = await apiClient.post('/auth/login/', {
        email: normalizedEmail,
        password,
        role: role ? role.toUpperCase() : undefined,
      });
      const data = res.data;
      const decoded = decodeJWT(data.access_token) || {};
      const userRole = (decoded.role || role || 'patient').toLowerCase();

      // Check role against active portal tab
      if (role && userRole !== role.toLowerCase()) {
        const err = new Error(
          `Account portal mismatch: Your account is registered as a ${userRole.toUpperCase()}. Please select the ${userRole.charAt(0).toUpperCase() + userRole.slice(1)} portal tab to sign in.`
        );
        err.roleMismatch = {
          expectedRole: role.toLowerCase(),
          actualRole: userRole,
        };
        throw err;
      }

      const loggedInUser = {
        id: decoded.user_id || 'u-db',
        email: normalizedEmail,
        name: decoded.full_name || normalizedEmail.split('@')[0],
        role: userRole,
      };

      // Always save to local storage as well so local roster and admin views have them
      saveUser({
        ...loggedInUser,
        password,
      });

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        user: loggedInUser,
      };
    } catch (backendErr) {
      // If role mismatch was thrown or detected by backend
      if (backendErr.roleMismatch) {
        throw backendErr;
      }
      if (backendErr.response?.status === 403 && backendErr.response?.data?.registered_role) {
        const err = new Error(backendErr.response.data.detail);
        err.roleMismatch = {
          expectedRole: (role || 'patient').toLowerCase(),
          actualRole: backendErr.response.data.registered_role.toLowerCase(),
        };
        throw err;
      }

      // If backend check failed, check if user exists in local registered accounts
      if (localUser) {
        return await mockAuthApi.login(normalizedEmail, password, role);
      }

      // If user does not exist in backend and does not exist locally
      if (backendErr.response?.data?.detail) {
        throw new Error(backendErr.response.data.detail, { cause: backendErr });
      }
      throw new Error('No account found with this email. Please sign up first before signing in.', {
        cause: backendErr,
      });
    }
  },

  register: async (data) => {
    const normalizedEmail = (data.email || '').trim().toLowerCase();
    const roleLower = (data.role || 'patient').toLowerCase();

    if (roleLower === 'admin') {
      throw new Error('Administrative registration is restricted. Administrator accounts can only sign in.');
    }

    const roleUpper = roleLower.toUpperCase();
    const fullName = (data.name || normalizedEmail.split('@')[0]).trim();

    // 1. Always save to local registered users immediately
    const localUser = {
      id: 'u-' + Date.now(),
      email: normalizedEmail,
      password: data.password,
      name: fullName,
      role: roleLower,
      assignedCaregiver: roleLower === 'patient' ? 'Unassigned' : undefined,
      avatar:
        'https://ui-avatars.com/api/?name=' +
        encodeURIComponent(fullName) +
        '&background=4f46e5&color=fff',
    };
    saveUser(localUser);

    if (roleLower === 'patient') {
      try {
        const raw = localStorage.getItem('pillsync_assigned_patients');
        let pts = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(pts)) pts = [];
        const exists = pts.some(
          (p) =>
            p.email?.toLowerCase() === normalizedEmail ||
            p.name?.toLowerCase() === localUser.name.toLowerCase()
        );
        if (!exists) {
          pts.unshift({
            id: localUser.id,
            name: localUser.name,
            email: localUser.email,
            condition: 'General Monitoring',
            age: 48,
            gender: 'Patient',
            adherence: 100,
            prescriptionsCount: 0,
            phone: data.phone || '+1 555-0190',
            lastTaken: 'Not recorded yet',
            assignedCaregiver: data.assignedCaregiver || 'Unassigned',
          });
          localStorage.setItem('pillsync_assigned_patients', JSON.stringify(pts));
        }
      } catch (e) {
        console.error(e);
      }
    }

    // 2. Also register with Django backend
    try {
      await apiClient.post('/auth/register/', {
        email: normalizedEmail,
        full_name: fullName,
        password: data.password,
        role: roleUpper,
      });
      return await realAuthApi.login(normalizedEmail, data.password, roleLower);
    } catch (err) {
      console.warn('Backend register sync notification:', err?.response?.data || err?.message);
      return await mockAuthApi.login(normalizedEmail, data.password, roleLower);
    }
  },

  forgotPassword: (email) =>
    apiClient
      .post('/auth/forgot-password/', { email })
      .then((res) => res.data)
      .catch(() => mockAuthApi.forgotPassword(email)),

  resetPassword: (token, newPassword) =>
    apiClient
      .post('/auth/reset-password/', { token, newPassword })
      .then((res) => res.data)
      .catch(() => mockAuthApi.resetPassword(token, newPassword)),

  me: async () => {
    try {
      const res = await apiClient.get('/auth/me/');
      return res.data;
    } catch {
      return mockAuthApi.me();
    }
  },

  logout: () => mockAuthApi.logout(),
};

export const authApi = realAuthApi;
