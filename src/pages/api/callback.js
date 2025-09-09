export default async function handler(req, res) {
    const { code } = req.query;
    const response = await fetch("https://zoom.us/oauth/token", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.ZOOM_REDIRECT_URI
      })
    });
    const tokens = await response.json();
    res.json(tokens);
  }