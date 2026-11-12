const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_VIEWERS = parseInt(process.env.MAX_VIEWERS || '5', 10);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

const app = express();
app.set('trust proxy', 1);
app.use(express.static('public'));

// ---- ICE servers (STUN always; TURN if configured) -------------------------
async function getIceServers() {
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  try {
    if (process.env.METERED_DOMAIN && process.env.METERED_API_KEY) {
      const r = await fetch(`https://${process.env.METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${process.env.METERED_API_KEY}`);
      if (r.ok) servers.push(...(await r.json()));
    } else if (process.env.TURN_URLS) {
      servers.push({
        urls: process.env.TURN_URLS.split(',').map((s) => s.trim()),
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL
      });
    }
  } catch (e) { console.error('TURN config error:', e.message); }
  return servers;
}
app.get('/api/ice', async (req, res) => res.json({ iceServers: await getIceServers() }));
app.get('/healthz', (req, res) => res.send('ok'));

// ---- Signaling -------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

const rooms = new Map(); // code -> { sender: ws, viewers: Map(id, ws) }
let nextId = 1;
const send = (ws, msg) => ws && ws.readyState === 1 && ws.send(JSON.stringify(msg));

function newCode() {
  for (let n = 0; n < 50; n++) {
    let c = '';
    for (let i = 0; i < 6; i++) c += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  throw new Error('no free code');
}

// crude brute-force guard: max 15 bad codes per IP per minute
const bad = new Map();
function tooManyBad(ip) {
  const now = Date.now();
  const arr = (bad.get(ip) || []).filter((t) => now - t < 60000);
  bad.set(ip, arr);
  return arr.length >= 15;
}
function noteBad(ip) { (bad.get(ip) || bad.set(ip, []).get(ip)).push(Date.now()); }

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.type === 'create' && !ws.room) {
      const code = newCode();
      rooms.set(code, { sender: ws, viewers: new Map() });
      ws.room = code; ws.role = 'sender';
      return send(ws, { type: 'created', room: code });
    }

    if (m.type === 'join' && !ws.room) {
      if (tooManyBad(ip)) return send(ws, { type: 'invalid', reason: 'Too many attempts. Wait a minute.' });
      const code = String(m.room || '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) { noteBad(ip); return send(ws, { type: 'invalid', reason: 'Wrong or expired code.' }); }
      if (room.viewers.size >= MAX_VIEWERS) return send(ws, { type: 'invalid', reason: 'This cast is full.' });
      ws.room = code; ws.role = 'viewer'; ws.id = String(nextId++);
      room.viewers.set(ws.id, ws);
      send(ws, { type: 'joined' });
      return send(room.sender, { type: 'viewer-joined', id: ws.id });
    }

    const room = rooms.get(ws.room);
    if (!room) return;
    if (ws.role === 'sender') send(room.viewers.get(m.to), { ...m, from: 'sender' });
    else if (ws.role === 'viewer' && (m.type === 'answer' || m.type === 'ice')) send(room.sender, { ...m, from: ws.id });
  });

  ws.on('close', () => {
    const room = rooms.get(ws.room);
    if (!room) return;
    if (ws.role === 'sender') {
      for (const v of room.viewers.values()) { send(v, { type: 'sender-left' }); v.close(); }
      rooms.delete(ws.room);
    } else {
      room.viewers.delete(ws.id);
      send(room.sender, { type: 'viewer-left', id: ws.id });
    }
  });
});

// keep connections alive behind proxies and drop dead ones
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 25000);

server.listen(PORT, () => console.log('ScreenCast online server on port ' + PORT));
