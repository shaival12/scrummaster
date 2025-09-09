import React from 'react';
import { useAuth } from '../contexts/AuthContext';

const AuthButton: React.FC = () => {
  const { user, isAuthenticated, isLoading, login, logout } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-gray-600">Loading...</span>
      </div>
    );
  }

  if (isAuthenticated && user) {
    return (
      <div className="flex items-center space-x-4 p-4 bg-green-50 border border-green-200 rounded-lg">
        <div className="flex-shrink-0">
          <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
            <span className="text-white font-semibold text-sm">
              {user.first_name?.[0]}{user.last_name?.[0]}
            </span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {user.display_name || `${user.first_name} ${user.last_name}`}
          </p>
          <p className="text-sm text-gray-500 truncate">
            {user.email}
          </p>
        </div>
        <button
          onClick={logout}
          className="px-4 py-2 text-sm font-medium text-red-700 bg-red-100 border border-red-300 rounded-md hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors"
        >
          Logout
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
      <div className="text-center">
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          Connect with Zoom
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Sign in with your Zoom account to access meeting features
        </p>
        <button
          onClick={login}
          className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
        >
          <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.568 8.16c-.169 0-.333.034-.483.095l-2.515 1.342c-.15.08-.25.23-.25.4v2.515c0 .17.1.32.25.4l2.515 1.342c.15.061.314.095.483.095.17 0 .333-.034.483-.095l2.515-1.342c.15-.08.25-.23.25-.4v-2.515c0-.17-.1-.32-.25-.4l-2.515-1.342c-.15-.061-.314-.095-.483-.095z"/>
          </svg>
          Sign in with Zoom
        </button>
      </div>
    </div>
  );
};

export default AuthButton;
