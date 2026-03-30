const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const { WebSocket, WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 8080);
const CLIENT_TOKEN = String(process.env.ADAPTER_CLIENT_TOKEN || '').trim();
const GATEWAY_URL = String(process.env.OPENCLAW_GATEWAY_URL || '').trim();
const GATEWAY_TOKEN = String(process.env.OPENCLAW_GATEWAY_TOKEN || '').trim();
const REVERSE_BRIDGE_URL = String(process.env.REVERSE_BRIDGE_URL || '').trim();
const REVERSE_BRIDGE_TOKEN = String(process.env.REVERSE_BRIDGE_TOKEN || CLIENT_TOKEN).trim();
const ALLOW_INSECURE_MOCK = String(process.env.ALLOW_MOCK_GATEWAY || 'true').toLowerCase() === 'true';

const app = express();
app.disable('x-powered-by');

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function getClientToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const headerToken = req.headers['x-adapter-token'];
  if (typeof headerToken === 'string') return headerToken.trim();
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  return (url.searchParams.get('token') || '').trim();
}

function isAuthorized(req) {
  if (!CLIENT_TOKEN) return false;
  return safeEqual(getClientToken(req), CLIENT_TOKEN);
}

function buildBackendUrl(req) {
  if (GATEWAY_URL) return GATEWAY_URL;
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const mock = url.searchParams.get('mock');
  if (ALLOW_INSECURE_MOCK && mock === '1') {
    return 'mock://gateway';
  }
  return '';
}

function createMockBackend() {
  const wss = new WebSocketServer({ noServer: true });
  return {
    kind: 'mock',
    attachClient(clientWs) {
      clientWs.send(JSON.stringify({ type: 'hello', source: 'mock-gateway' }));
      clientWs.on('message', (raw) => {
        if (clientWs.readyState !== WebSocket.OPEN) return;
        clientWs.send(String(raw));
      });
    },
    wss,
  };
}

function connectBackend(targetUrl) {
  if (targetUrl === 'mock://gateway') {
    return createMockBackend();
  }

  const headers = {};
  if (GATEWAY_TOKEN) {
    headers.authorization = `Bearer ${GATEWAY_TOKEN}`;
  }

  const backendWs = new WebSocket(targetUrl, { headers });
  return {
    kind: 'remote',
    socket: backendWs,
  };
}

function bridgeHeaders() {
  const headers = {};
  if (REVERSE_BRIDGE_TOKEN) headers.authorization = `Bearer ${REVERSE_BRIDGE_TOKEN}`;
  return headers;
}

function startReverseBridgeClient() {
  if (!REVERSE_BRIDGE_URL) return;

  const sockets = new Map();
  let bridge;
  let retryTimer;

  function cleanupSocket(id, code = 1000, reason = 'bridge_closed') {
    const socket = sockets.get(id);
    if (!socket) return;
    sockets.delete(id);
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close(code, reason);
    }
  }

  function scheduleReconnect() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, 2000);
  }

  function send(obj) {
    if (bridge && bridge.readyState === WebSocket.OPEN) {
      bridge.send(JSON.stringify(obj));
    }
  }

  function connect() {
    console.log(`[adapter] connecting reverse bridge ${REVERSE_BRIDGE_URL}`);
    bridge = new WebSocket(REVERSE_BRIDGE_URL, { headers: bridgeHeaders() });

    bridge.on('open', () => {
      console.log('[adapter] reverse bridge connected');
    });

    bridge.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch {
        console.error('[adapter] invalid bridge frame');
        return;
      }

      if (msg.type === 'open') {
        if (!GATEWAY_URL) {
          send({ type: 'close', id: msg.id, code: 1011, reason: 'backend_not_configured' });
          return;
        }

        const backend = connectBackend(GATEWAY_URL);
        if (backend.kind === 'mock') {
          send({ type: 'close', id: msg.id, code: 1011, reason: 'mock_backend_unsupported' });
          return;
        }

        const backendWs = backend.socket;
        sockets.set(msg.id, backendWs);

        backendWs.on('open', () => console.log(`[adapter] backend open id=${msg.id}`));
        backendWs.on('message', (data, isBinary) => {
          send({ type: 'data', id: msg.id, binary: Boolean(isBinary), data: Buffer.from(data).toString('base64') });
        });
        backendWs.on('close', (code, reason) => {
          sockets.delete(msg.id);
          send({ type: 'close', id: msg.id, code: code || 1000, reason: reason?.toString() || 'backend_closed' });
        });
        backendWs.on('error', (err) => {
          console.error('[adapter] backend websocket error', err);
          send({ type: 'close', id: msg.id, code: 1011, reason: 'backend_error' });
        });
        return;
      }

      const backendWs = sockets.get(msg.id);
      if (!backendWs) return;

      if (msg.type === 'data') {
        if (backendWs.readyState === WebSocket.OPEN) {
          backendWs.send(Buffer.from(String(msg.data || ''), 'base64'), { binary: msg.binary !== false });
        }
      } else if (msg.type === 'close') {
        cleanupSocket(msg.id, msg.code || 1000, msg.reason || 'client_closed');
      }
    });

    bridge.on('close', (code, reason) => {
      console.log(`[adapter] reverse bridge disconnected code=${code} reason=${reason}`);
      for (const id of [...sockets.keys()]) cleanupSocket(id, 1011, 'bridge_disconnected');
      scheduleReconnect();
    });

    bridge.on('error', (err) => {
      console.error('[adapter] reverse bridge error', err);
    });
  }

  connect();
}

app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    service: 'claw3d-gateway-adapter',
    hasClientToken: Boolean(CLIENT_TOKEN),
    backendConfigured: Boolean(GATEWAY_URL),
    reverseBridgeConfigured: Boolean(REVERSE_BRIDGE_URL),
    mockEnabled: ALLOW_INSECURE_MOCK,
    now: new Date().toISOString(),
  });
});

app.get('/', (_req, res) => {
  res.type('text/plain').send('claw3d-gateway-adapter\n');
});

const server = http.createServer(app);
const clientWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/api/gateway/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  if (!isAuthorized(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  clientWss.handleUpgrade(req, socket, head, (clientWs) => {
    clientWss.emit('connection', clientWs, req);
  });
});

clientWss.on('connection', (clientWs, req) => {
  const backendUrl = buildBackendUrl(req);
  if (!backendUrl) {
    clientWs.close(1011, 'backend_not_configured');
    return;
  }

  const backend = connectBackend(backendUrl);

  if (backend.kind === 'mock') {
    backend.attachClient(clientWs);
    return;
  }

  const backendWs = backend.socket;

  backendWs.on('open', () => {
    console.log(`[adapter] connected to backend ${backendUrl}`);
  });

  backendWs.on('message', (raw, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(raw, { binary: isBinary });
    }
  });

  backendWs.on('close', (code, reason) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(code || 1011, reason?.toString() || 'backend_closed');
    }
  });

  backendWs.on('error', (err) => {
    console.error('[adapter] backend websocket error', err);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1011, 'backend_error');
    }
  });

  clientWs.on('message', (raw, isBinary) => {
    if (backendWs.readyState === WebSocket.OPEN) {
      backendWs.send(raw, { binary: isBinary });
    }
  });

  clientWs.on('close', () => {
    if (backendWs.readyState === WebSocket.OPEN || backendWs.readyState === WebSocket.CONNECTING) {
      backendWs.close(1000, 'client_closed');
    }
  });

  clientWs.on('error', (err) => {
    console.error('[adapter] client websocket error', err);
    if (backendWs.readyState === WebSocket.OPEN || backendWs.readyState === WebSocket.CONNECTING) {
      backendWs.close(1011, 'client_error');
    }
  });
});

server.listen(PORT, () => {
  console.log(`[adapter] listening on :${PORT}`);
  if (REVERSE_BRIDGE_URL) startReverseBridgeClient();
});
