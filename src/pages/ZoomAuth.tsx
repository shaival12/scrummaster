import React, { useEffect } from 'react';
import { getZoomAuthUrl } from '../services/authService';

const ZoomAuth: React.FC = () => {
  useEffect(() => {
    // Redirect to Zoom OAuth immediately when this component mounts
    const authUrl = getZoomAuthUrl();
    window.location.href = authUrl;
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
            Redirecting to Zoom...
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            You will be redirected to Zoom for authentication.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ZoomAuth;
