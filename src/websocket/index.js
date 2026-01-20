import { WebSocketServer } from 'ws';

let wss = null;
const clients = new Set();

export function initialize(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

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

  console.log('WebSocket server initialized');
}

function handleMessage(ws, data) {
  switch (data.type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;
    case 'subscribe':
      // Could implement channel subscriptions here
      break;
    default:
      console.log('Unknown WebSocket message type:', data.type);
  }
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
