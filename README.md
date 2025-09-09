# Voice Scrum Master with Zoom Authentication

A voice-to-action AI standup facilitator that integrates with Zoom OAuth for authentication.

## Features

- **Zoom OAuth Integration**: Secure authentication with Zoom accounts
- **Voice Recognition**: Uses Web Speech API for voice input
- **Text-to-Speech**: AI-powered voice responses
- **Meeting Management**: Automated standup facilitation
- **Time Tracking**: Per-speaker time limits and tracking
- **Action Extraction**: Automatically parses tasks and blockers from speech
- **Export Options**: JSON export, email summaries, Slack integration

## Setup Instructions

### 1. Environment Configuration

✅ **Already configured!** Your Zoom OAuth credentials are already set up in the `.env` file:

```env
VITE_ZOOM_CLIENT_ID=2POL5JoqSHyaUwo4Xwyg
VITE_ZOOM_CLIENT_SECRET=uFvh8QLW7H2rQ9GNiMyxa0vz4ukaWSOs
VITE_ZOOM_REDIRECT_URI=http://localhost:5173/auth/callback
VITE_APP_URL=http://localhost:5173
```

### 2. Zoom App Configuration

✅ **Already configured!** Your Zoom OAuth app is set up with:

- **Client ID**: `2POL5JoqSHyaUwo4Xwyg`
- **Redirect URI**: `http://localhost:5173/auth/callback`
- **Scopes**: `user:read`, `meeting:write`, `meeting:read`

For production deployment, update the redirect URI in your Zoom app settings to your production domain.

### 3. Install Dependencies

```bash
npm install
```

### 4. Start Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

## Authentication Flow

1. **Login**: Click "Sign in with Zoom" button
2. **Redirect**: User is redirected to Zoom OAuth page
3. **Authorization**: User grants permissions to your app
4. **Callback**: Zoom redirects back to `/auth/callback` with authorization code
5. **Token Exchange**: App exchanges code for access token
6. **User Info**: App fetches user information from Zoom API
7. **Session**: User is authenticated and can access the app

## URL Structure

- `/` - Main app (requires authentication)
- `/auth/zoom` - Initiates Zoom OAuth flow
- `/auth/callback` - Handles OAuth callback from Zoom

## API Endpoints Used

- `https://zoom.us/oauth/authorize` - OAuth authorization
- `https://zoom.us/oauth/token` - Token exchange and refresh
- `https://api.zoom.us/v2/users/me` - Get user information

## Security Features

- **State Parameter**: Prevents CSRF attacks
- **Token Refresh**: Automatic token refresh before expiration
- **Secure Storage**: Tokens stored in localStorage with expiration
- **HTTPS Required**: OAuth requires HTTPS in production

## Production Deployment

1. Update environment variables for production
2. Set `VITE_ZOOM_REDIRECT_URI` to your production callback URL
3. Update Zoom app settings with production redirect URI
4. Deploy to your hosting platform (Vercel, Netlify, etc.)

## Troubleshooting

### Common Issues

1. **CORS Errors**: Ensure your Zoom app redirect URI matches exactly
2. **Token Expired**: The app automatically refreshes tokens
3. **Speech Recognition**: Requires HTTPS in production
4. **Microphone Permissions**: User must grant microphone access

### Development Tips

- Use Chrome/Edge for best speech recognition support
- Test on HTTPS even in development for full functionality
- Check browser console for detailed error messages
- Verify environment variables are loaded correctly

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details
