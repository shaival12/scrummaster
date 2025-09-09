import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSearchParams, useNavigate } from 'react-router-dom';

const AuthCallback: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { handleAuthCallback } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const code = searchParams.get('code');
        const error = searchParams.get('error');
        const state = searchParams.get('state');

        console.log('🔍 OAuth Callback Debug:', {
          code: code ? `${code.substring(0, 10)}...` : 'null',
          error,
          state,
          expectedState: 'zoom_auth_state',
          allParams: Object.fromEntries(searchParams.entries()),
          currentUrl: window.location.href
        });

        if (error) {
          console.error('❌ OAuth Error:', error);
          setErrorMessage(`Authentication failed: ${error}`);
          setStatus('error');
          return;
        }

        if (!code) {
          console.error('❌ No authorization code received');
          setErrorMessage('No authorization code received');
          setStatus('error');
          return;
        }

        // Verify state parameter for security
        console.log('🔐 State verification:', {
          receivedState: state,
          expectedState: 'zoom_auth_state',
          match: state === 'zoom_auth_state'
        });

        if (state !== 'zoom_auth_state') {
          console.error('❌ State parameter mismatch:', {
            received: state,
            expected: 'zoom_auth_state'
          });
          setErrorMessage(`Invalid state parameter. Received: ${state}, Expected: zoom_auth_state`);
          setStatus('error');
          return;
        }

        const success = await handleAuthCallback(code);
        
        if (success) {
          setStatus('success');
          // Redirect to main app after successful authentication
          setTimeout(() => {
            navigate('/');
          }, 2000);
        } else {
          setErrorMessage('Failed to complete authentication');
          setStatus('error');
        }
      } catch (error) {
        console.error('Error in auth callback:', error);
        setErrorMessage('An unexpected error occurred');
        setStatus('error');
      }
    };

    handleCallback();
  }, [searchParams, handleAuthCallback, navigate]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
              Completing Authentication...
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Please wait while we complete your Zoom authentication.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100">
              <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
              Authentication Successful!
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              You have been successfully authenticated with Zoom. Redirecting to the app...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
            <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
            Authentication Failed
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            {errorMessage}
          </p>
          <div className="mt-6">
            <button
              onClick={() => navigate('/')}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Return to App
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthCallback;
