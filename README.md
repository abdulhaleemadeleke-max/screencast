# ScreenCast Online

Anyone opens the site, clicks **Start casting**, gets a 6-character code, and a viewer
(on any network) enters that code to watch. Each code is its own private session.

## Run on your own laptop (test)
    npm install
    npm start
Open http://localhost:3000

## Put it on the internet (Render.com, free tier works for testing)
1. Create a GitHub account and a new repository. Upload everything in this folder
   (not node_modules).
2. On render.com: New > Web Service > connect your repository.
   - Build command: npm install
   - Start command: npm start
3. Deploy. You get an https address like https://screencast-xyz.onrender.com
   (HTTPS is required for screen sharing, and Render provides it).

## Make it work across different networks (TURN)
Most connections work with the built-in STUN servers. Some networks (office Wi-Fi,
some mobile data) block direct connections and need a TURN relay.

Easiest: create a free account at metered.ca, create a TURN app, then add these
environment variables in Render (Environment tab):
    METERED_DOMAIN   = yourapp.metered.live
    METERED_API_KEY  = your key
Or use any TURN server:
    TURN_URLS=turn:host:3478,turns:host:443?transport=tcp
    TURN_USERNAME=...
    TURN_CREDENTIAL=...
Optional: MAX_VIEWERS (default 5).

## Notes
- Sender must use a desktop browser (Chrome/Edge/Firefox). Phones can watch only.
- Video is peer-to-peer; your server only carries tiny signaling messages.
  TURN relays carry video only when a direct path is impossible (this costs bandwidth).
