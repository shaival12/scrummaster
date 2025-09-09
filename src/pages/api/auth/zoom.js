// pages/api/auth/zoom.js
export default async function handler(req, res) {
    const authUrl = `https://zoom.us/oauth/authorize?response_type=code&client_id=${process.env.ZOOM_CLIENT_ID}&redirect_uri=${process.env.ZOOM_REDIRECT_URI}`;
    res.redirect(authUrl);
  }