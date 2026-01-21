import { WebSocketServer } from 'ws';

let wss = null;
const clients = new Set();
const sessionClients = new Map(); // sessionId -> Set of WebSocket clients
const clientSessions = new Map(); // ws -> sessionId

export function initialize(server) {
  // Create WebSocket server without automatic upgrade handling
  // This works better with reverse proxies like Render
  wss = new WebSocketServer({ noServer: true });

  // Handle upgrade manually
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    clients.add(ws);

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        handleMessage(ws, data);
      } catch (error) {
        console.error('WebSocket message parse error:', error);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
      const sessionId = clientSessions.get(ws);
      if (sessionId) {
        const sessionSet = sessionClients.get(sessionId);
        if (sessionSet) {
          sessionSet.delete(ws);
          if (sessionSet.size === 0) {
            sessionClients.delete(sessionId);
          }
        }
        clientSessions.delete(ws);
      }
      clients.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      clients.delete(ws);
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      data: { message: 'Welcome to Eliza Town', timestamp: Date.now() }
    }));
  });

  console.log('WebSocket server initialized (manual upgrade handling)');
}

function handleMessage(ws, data) {
  switch (data.type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;
    case 'subscribe':
      // Could implement channel subscriptions here
      break;
    case 'register_session':
      // Register this client's session ID
      const sessionId = data.sessionId;
      if (sessionId) {
        clientSessions.set(ws, sessionId);
        if (!sessionClients.has(sessionId)) {
          sessionClients.set(sessionId, new Set());
        }
        sessionClients.get(sessionId).add(ws);
        console.log(`Registered session: ${sessionId}`);
        ws.send(JSON.stringify({ type: 'session_registered', sessionId }));
      }
      break;
    default:
      console.log('Unknown WebSocket message type:', data.type);
  }
}

// Get all active session IDs
export function getActiveSessions() {
  return [...sessionClients.keys()];
}

export function broadcast(message) {
  if (!wss) return;

  const payload = JSON.stringify(message);

  for (const client of clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(payload);
      } catch (error) {
        console.error('Broadcast error:', error);
        clients.delete(client);
      }
    }
  }
}

export function sendTo(ws, message) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

export function getConnectionCount() {
  return clients.size;
}
