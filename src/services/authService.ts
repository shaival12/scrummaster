// Zoom OAuth Configuration
const ZOOM_CONFIG = {
  clientId: import.meta.env.VITE_ZOOM_CLIENT_ID || '',
  redirectUri: import.meta.env.VITE_ZOOM_REDIRECT_URI || `${window.location.origin}/auth/callback`,
  scope: 'user:read:email', // Most minimal scope for free accounts
  responseType: 'code',
  state: 'zoom_auth_state' // You can generate a random state for security
};

// Generate Zoom OAuth URL
export const getZoomAuthUrl = (): string => {
  console.log('🔧 ZOOM_CONFIG values:', ZOOM_CONFIG);
  console.log('🔧 Environment variables:', {
    VITE_ZOOM_CLIENT_ID: import.meta.env.VITE_ZOOM_CLIENT_ID,
    VITE_ZOOM_REDIRECT_URI: import.meta.env.VITE_ZOOM_REDIRECT_URI,
    VITE_APP_URL: import.meta.env.VITE_APP_URL
  });

  const params = new URLSearchParams({
    response_type: ZOOM_CONFIG.responseType,
    client_id: ZOOM_CONFIG.clientId,
    redirect_uri: ZOOM_CONFIG.redirectUri,
    scope: ZOOM_CONFIG.scope,
    state: ZOOM_CONFIG.state
  });

  const authUrl = `https://zoom.us/oauth/authorize?${params.toString()}`;
  
  console.log('🔗 Generated OAuth URL:', {
    clientId: ZOOM_CONFIG.clientId,
    redirectUri: ZOOM_CONFIG.redirectUri,
    state: ZOOM_CONFIG.state,
    scope: ZOOM_CONFIG.scope,
    fullUrl: authUrl
  });

  return authUrl;
};

// Exchange authorization code for access token
export const exchangeCodeForToken = async (code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
} | null> => {
  try {
    const clientId = import.meta.env.VITE_ZOOM_CLIENT_ID;
    const clientSecret = import.meta.env.VITE_ZOOM_CLIENT_SECRET;
    
    console.log('🔑 Token exchange request:', {
      clientId: clientId ? `${clientId.substring(0, 10)}...` : 'missing',
      hasClientSecret: !!clientSecret,
      code: code.substring(0, 10) + '...',
      redirectUri: ZOOM_CONFIG.redirectUri
    });
    
    if (!clientId || !clientSecret) {
      console.error('❌ Missing client credentials');
      throw new Error('Zoom client credentials not configured');
    }

    const requestBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: ZOOM_CONFIG.redirectUri
    });

    console.log('📤 Making token request to Zoom...');
    const response = await fetch('https://zoom.us/oauth/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: requestBody
    });

    console.log('📥 Token response status:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Token exchange failed:', {
        status: response.status,
        statusText: response.statusText,
        errorBody: errorText
      });
      throw new Error(`Token exchange failed: ${response.statusText}`);
    }

    const tokenData = await response.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
      token_type: string;
    };

    console.log('✅ Token exchange successful:', {
      hasAccessToken: !!tokenData.access_token,
      hasRefreshToken: !!tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      scope: tokenData.scope,
      tokenType: tokenData.token_type
    });

    return tokenData;
  } catch (error) {
    console.error('Error exchanging code for token:', error);
    return null;
  }
};

// Get user info from Zoom
export const getZoomUserInfo = async (accessToken: string): Promise<{
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  display_name: string;
} | null> => {
  try {
    const response = await fetch('https://api.zoom.us/v2/users/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to get user info: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error getting user info:', error);
    return null;
  }
};

// Refresh access token
export const refreshAccessToken = async (refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
} | null> => {
  try {
    const clientId = import.meta.env.VITE_ZOOM_CLIENT_ID;
    const clientSecret = import.meta.env.VITE_ZOOM_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      throw new Error('Zoom client credentials not configured');
    }

    const response = await fetch('https://zoom.us/oauth/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      })
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.statusText}`);
    }

    return await response.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
  } catch (error) {
    console.error('Error refreshing token:', error);
    return null;
  }
};

// Local storage helpers
export const saveAuthData = (authData: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_info: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    display_name: string;
  };
}) => {
  const expiresAt = Date.now() + (authData.expires_in * 1000);
  localStorage.setItem('zoom_auth', JSON.stringify({
    ...authData,
    expires_at: expiresAt
  }));
};

export const getAuthData = () => {
  const authData = localStorage.getItem('zoom_auth');
  if (!authData) return null;
  
  const parsed = JSON.parse(authData);
  
  // Check if token is expired
  if (Date.now() >= parsed.expires_at) {
    localStorage.removeItem('zoom_auth');
    return null;
  }
  
  return parsed;
};

export const clearAuthData = () => {
  localStorage.removeItem('zoom_auth');
};
