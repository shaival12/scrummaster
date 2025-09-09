import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { 
  getAuthData, 
  clearAuthData, 
  saveAuthData, 
  refreshAccessToken,
  getZoomUserInfo 
} from '../services/authService';

interface User {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  display_name: string;
}

interface AuthData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user_info: User;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => void;
  logout: () => void;
  handleAuthCallback: (code: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Check for existing auth data on mount
  useEffect(() => {
    const checkAuthStatus = async () => {
      try {
        const authData = getAuthData();
        
        if (authData) {
          // Check if token needs refresh
          const timeUntilExpiry = authData.expires_at - Date.now();
          const fiveMinutes = 5 * 60 * 1000; // 5 minutes in milliseconds
          
          if (timeUntilExpiry < fiveMinutes) {
            // Token expires soon, try to refresh
            const refreshedData = await refreshAccessToken(authData.refresh_token);
            
            if (refreshedData) {
              const userInfo = await getZoomUserInfo(refreshedData.access_token);
              if (userInfo) {
                const newAuthData = {
                  access_token: refreshedData.access_token,
                  refresh_token: refreshedData.refresh_token,
                  expires_in: refreshedData.expires_in,
                  user_info: userInfo
                };
                saveAuthData(newAuthData);
                setUser(userInfo);
                setIsAuthenticated(true);
              } else {
                clearAuthData();
              }
            } else {
              clearAuthData();
            }
          } else {
            // Token is still valid
            setUser(authData.user_info);
            setIsAuthenticated(true);
          }
        }
      } catch (error) {
        console.error('Error checking auth status:', error);
        clearAuthData();
      } finally {
        setIsLoading(false);
      }
    };

    checkAuthStatus();
  }, []);

  const login = () => {
    // This will redirect to Zoom OAuth
    window.location.href = `${import.meta.env.VITE_APP_URL || window.location.origin}/auth/zoom`;
  };

  const logout = () => {
    clearAuthData();
    setUser(null);
    setIsAuthenticated(false);
  };

  const handleAuthCallback = async (code: string): Promise<boolean> => {
    try {
      console.log('🔄 Starting auth callback with code:', code.substring(0, 10) + '...');
      setIsLoading(true);
      
      // Import the exchange function dynamically to avoid circular imports
      const { exchangeCodeForToken } = await import('../services/authService');
      
      console.log('🔄 Exchanging code for token...');
      const tokenData = await exchangeCodeForToken(code);
      
      if (!tokenData) {
        console.error('❌ Token exchange failed');
        throw new Error('Failed to exchange code for token');
      }

      console.log('✅ Token exchange successful:', {
        hasAccessToken: !!tokenData.access_token,
        hasRefreshToken: !!tokenData.refresh_token,
        expiresIn: tokenData.expires_in
      });

      console.log('🔄 Getting user info...');
      const userInfo = await getZoomUserInfo(tokenData.access_token);
      
      if (!userInfo) {
        console.error('❌ Failed to get user info');
        throw new Error('Failed to get user info');
      }

      console.log('✅ User info retrieved:', {
        id: userInfo.id,
        name: userInfo.display_name || `${userInfo.first_name} ${userInfo.last_name}`,
        email: userInfo.email
      });

      const authData = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in,
        user_info: userInfo
      };

      console.log('💾 Saving auth data...');
      saveAuthData(authData);
      setUser(userInfo);
      setIsAuthenticated(true);
      
      console.log('🎉 Authentication completed successfully!');
      return true;
    } catch (error) {
      console.error('❌ Error handling auth callback:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const value: AuthContextType = {
    user,
    isAuthenticated,
    isLoading,
    login,
    logout,
    handleAuthCallback
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
