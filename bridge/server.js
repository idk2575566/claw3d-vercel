const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 19090);
const ADAPTER_TOKEN = String(process.env.ADAPTER_TOKEN || '').trim();
const BROWSER_TOKEN = String(process.env.BROWSER_TOKEN || ADAPTER_TOKEN).trim();

const app = express();
app.disable('x-powered-by');

const state = {
  adapter: null,
  clients: new Map(),
};

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function tokenFromReq(req) {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const headerToken = req.headers['x-adapter-token'];
  if (typeof headerToken === 'string') return headerToken.trim();
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  return (url.searchParams.get('token') || '').trim();
}

function sendJson(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function closeClient(id, code = 1011, reason = 'adapter_unavailable') {
  const client = state.clients.get(id);
  if (!client) return;
  state.clients.delete(id);
  if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
    client.close(code, reason);
  }
}

function adapterStatus() {
  return {
    connected: Boolean(state.adapter && state.adapter.readyState === WebSocket.OPEN),
    activeClients: state.clients.size,
  };
}

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'claw3d-reverse-bridge', ...adapterStatus() });
});

app.get('/', (_req, res) => {
  res.type('text/plain').send('claw3d-reverse-bridge\n');
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;

  if (path === '/reverse') {
    if (!ADAPTER_TOKEN || !safeEqual(tokenFromReq(req), ADAPTER_TOKEN)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
  } else if (path === '/api/gateway/ws') {
    if (!BROWSER_TOKEN || !safeEqual(tokenFromReq(req), BROWSER_TOKEN)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!(state.adapter && state.adapter.readyState === WebSocket.OPEN)) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }
  } else {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/reverse') {
    if (state.adapter && state.adapter.readyState === WebSocket.OPEN) {
      state.adapter.close(1012, 'replaced');
    }
    state.adapter = ws;
    console.log('[bridge] adapter connected');

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch {
        console.error('[bridge] invalid adapter frame');
        return;
      }
      const client = state.clients.get(msg.id);
      if (!client) return;
      if (msg.type === 'data') {
        if (client.readyState === WebSocket.OPEN) {
          client.send(Buffer.from(String(msg.data || ''), 'base64'), { binary: msg.binary !== false });
        }
      } else if (msg.type === 'close') {
        closeClient(msg.id, msg.code || 1000, msg.reason || 'closed');
      }
    });

    ws.on('close', (code, reason) => {
      if (state.adapter === ws) state.adapter = null;
      console.log(`[bridge] adapter disconnected code=${code} reason=${reason}`);
      for (const id of [...state.clients.keys()]) closeClient(id, 1011, 'adapter_disconnected');
    });

    ws.on('error', (err) => console.error('[bridge] adapter error', err));
    return;
  }

  const id = crypto.randomUUID();
  state.clients.set(id, ws);
  console.log(`[bridge] browser client connected id=${id}`);
  sendJson(state.adapter, { type: 'open', id });

  ws.on('message', (raw, isBinary) => {
    sendJson(state.adapter, {
      type: 'data',
      id,
      binary: Boolean(isBinary),
      data: Buffer.from(raw).toString('base64'),
    });
  });

  ws.on('close', (code, reason) => {
    state.clients.delete(id);
    sendJson(state.adapter, { type: 'close', id, code, reason: reason?.toString() || 'client_closed' });
    console.log(`[bridge] browser client disconnected id=${id} code=${code}`);
  });

  ws.on('error', (err) => console.error('[bridge] browser client error', err));
});

server.listen(PORT, () => {
  console.log(`[bridge] listening on :${PORT}`);
});
