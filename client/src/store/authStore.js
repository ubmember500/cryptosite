import { create } from 'zustand';
import { authService } from '../services/authService';

export const useAuthStore = create((set, get) => ({
  // State
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  loading: false,

  // Initialize: Check localStorage on startup
  initialize: async () => {
    set({ loading: true });

    const storedAccessToken = localStorage.getItem('accessToken');
    const storedRefreshToken = localStorage.getItem('refreshToken');
    const storedUser = localStorage.getItem('user');

    if (storedAccessToken && storedUser) {
      const tokenWeAreVerifying = storedAccessToken;
      let user = null;
      
      try {
        // Parse stored user
        user = JSON.parse(storedUser);

        // Set token in state first so API interceptor can use it
        set({
          accessToken: storedAccessToken,
          refreshToken: storedRefreshToken,
          user,
          isAuthenticated: true,
        });

        // Verify token is still valid by fetching current user
        const currentUser = await authService.getMe();

        // Update with fresh user data from server
        set({
          user: currentUser.user || user,
          isAuthenticated: true,
          loading: false,
        });
      } catch (error) {
        // Only clear storage if we're still on the same token (avoid race: login() may have just set a new one)
        if (get().accessToken !== tokenWeAreVerifying) {
          set({ loading: false });
          return;
        }
        // Server error (5xx): don't log out - keep cached user so the app still works
        const status = error.response?.status;
        if (status >= 500) {
          console.warn('[AuthStore] getMe server error, keeping cached session:', status);
          // Re-parse user if it failed to parse earlier
          if (!user) {
            try {
              user = JSON.parse(storedUser);
            } catch (parseError) {
              console.error('[AuthStore] Failed to parse stored user:', parseError);
              // Clear invalid data
              localStorage.removeItem('accessToken');
              localStorage.removeItem('refreshToken');
              localStorage.removeItem('user');
              set({
                user: null,
                accessToken: null,
                refreshToken: null,
                isAuthenticated: false,
                loading: false,
              });
              return;
            }
          }
          set({ user, isAuthenticated: true, loading: false });
          return;
        }
        // Token is invalid (401/404) or other client error, clear storage
        console.error('[AuthStore] Token validation failed:', error);
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
          loading: false,
        });
      }
    } else {
      set({ loading: false });
    }
  },

  // Login action
  login: async (email, password) => {
    console.log('[AuthStore] login() called');
    set({ loading: true });
    try {
      console.log('[AuthStore] Calling authService.login(email, password)');
      const response = await authService.login(email, password);
      if (!response) {
        console.error('[AuthStore] authService.login returned no response');
        throw new Error('No response from login');
      }
      const { user, accessToken, refreshToken } = response;
      console.log('[AuthStore] Response received', {
        hasUser: !!user,
        hasAccessToken: !!accessToken,
        hasRefreshToken: !!refreshToken,
      });

      if (!accessToken) {
        console.error('[AuthStore] Missing accessToken in response', response);
        throw new Error('Invalid login response: missing accessToken');
      }

      // Store in localStorage
      localStorage.setItem('accessToken', accessToken);
      if (refreshToken) {
        localStorage.setItem('refreshToken', refreshToken);
      }
      localStorage.setItem('user', JSON.stringify(user));
      console.log('[AuthStore] Tokens and user stored in localStorage');

      // Update state
      set({
        user,
        accessToken,
        refreshToken,
        isAuthenticated: true,
        loading: false,
      });
      console.log('[AuthStore] State updated (isAuthenticated: true)');

      return response;
    } catch (error) {
      console.error('[AuthStore] login failed', error?.message || error, error?.response?.data);
      set({
        user: null,
        accessToken: null,
        refreshToken: null,
        isAuthenticated: false,
        loading: false,
      });
      throw error;
    }
  },

  // Register action
  register: async (username, email, password) => {
    set({ loading: true });
    try {
      const response = await authService.register(username, email, password);
      const { user, accessToken, refreshToken } = response;

      // Store in localStorage
      localStorage.setItem('accessToken', accessToken);
      if (refreshToken) {
        localStorage.setItem('refreshToken', refreshToken);
      }
      localStorage.setItem('user', JSON.stringify(user));

      // Update state
      set({
        user,
        accessToken,
        refreshToken,
        isAuthenticated: true,
        loading: false,
      });

      return response;
    } catch (error) {
      set({
        user: null,
        accessToken: null,
        refreshToken: null,
        isAuthenticated: false,
        loading: false,
      });
      throw error;
    }
  },

  // Logout action
  logout: () => {
    // Clear localStorage
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');

    // Clear state
    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      loading: false,
    });
  },

  // Fetch current user from server and update state (e.g. after Telegram connect/disconnect).
  fetchUser: async () => {
    const { accessToken } = get();
    if (!accessToken) return null;
    try {
      const data = await authService.getMe();
      const user = data.user || data;
      if (user) {
        set({ user });
        localStorage.setItem('user', JSON.stringify(user));
        return user;
      }
      return null;
    } catch (error) {
      console.error('[AuthStore] fetchUser failed:', error?.message);
      return null;
    }
  },

  // Check auth status
  checkAuth: async () => {
    const { accessToken } = get();
    
    if (!accessToken) {
      // Try to get from localStorage
      const storedAccessToken = localStorage.getItem('accessToken');
      const storedUser = localStorage.getItem('user');

      if (storedAccessToken && storedUser) {
        try {
          const user = JSON.parse(storedUser);
          set({
            user,
            accessToken: storedAccessToken,
            isAuthenticated: true,
            loading: false,
          });
        } catch (error) {
          // Invalid stored data, clear it
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
          set({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
            loading: false,
          });
        }
      } else {
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
          loading: false,
        });
      }
    } else {
      // Token exists, verify it's still valid
      try {
        await authService.getMe();
        set({ isAuthenticated: true, loading: false });
      } catch (error) {
        // Server error (5xx): don't log out, keep session
        if (error.response?.status >= 500) {
          set({ isAuthenticated: true, loading: false });
          return;
        }
        // Token invalid (401/404), logout
        get().logout();
      }
    }
  },
}));
