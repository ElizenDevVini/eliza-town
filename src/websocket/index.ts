import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { getDemoState, isVisualDemoRunning } from '../eliza/visualDemo.js';

// Type definitions
export interface WebSocketMessage {
  type: string;
  data?: Record<string, unknown>;
  timestamp?: number;
}

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();
let lastLoggedClientCount = 0;

export function initialize(server: Server): void {
  // Create WebSocket server without automatic upgrade handling
  // This works better with reverse proxies like Render
  wss = new WebSocketServer({ noServer: true });

  // Handle upgrade manually
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url || '/', `http://${request.headers.host}`);
    const pathname = url.pathname;

    if (pathname === '/ws') {
      wss!.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        wss!.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    
    // Only log when we go from 0 to 1 client (first real connection)
    if (clients.size === 1 && lastLoggedClientCount === 0) {
      console.log('WebSocket client connected');
      lastLoggedClientCount = 1;
    }

    ws.on('message', (message: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const data = JSON.parse(message.toString()) as WebSocketMessage;
        handleMessage(ws, data);
      } catch (error) {
        // Silently ignore parse errors
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      // Only log when all clients disconnect
      if (clients.size === 0 && lastLoggedClientCount > 0) {
        console.log('All WebSocket clients disconnected');
        lastLoggedClientCount = 0;
      }
    });

    ws.on('error', () => {
      // Silently handle errors - they're common during reconnects
      clients.delete(ws);
    });

    // Send welcome message
    try {
      ws.send(JSON.stringify({
        type: 'connected',
        data: { message: 'Welcome to Eliza Town', timestamp: Date.now() }
      }));
      
      // If visual demo is running, send current state to new client
      if (isVisualDemoRunning()) {
        const state = getDemoState();
        ws.send(JSON.stringify({
          type: 'demo_state',
          data: {
            agents: state.agents,
            bubbles: state.activeBubbles.map(b => ({
              agentId: b.agentId,
              text: b.text,
              type: b.type,
              ttl: b.expiresAt - Date.now(),
            })),
            currentTask: state.currentTask,
            taskProgress: state.taskProgress,
          }
        }));
      }
    } catch {
      // Ignore send errors on connection
    }
  });

  console.log('WebSocket server initialized');
}

function handleMessage(ws: WebSocket, data: WebSocketMessage): void {
  switch (data.type) {
    case 'ping':
      try {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      } catch {
        // Ignore send errors
      }
      break;
    case 'subscribe':
      // Could implement channel subscriptions here
      break;
    case 'get_demo_state':
      // Client requesting current demo state
      if (isVisualDemoRunning()) {
        const state = getDemoState();
        try {
          ws.send(JSON.stringify({
            type: 'demo_state',
            data: {
              agents: state.agents,
              bubbles: state.activeBubbles.map(b => ({
                agentId: b.agentId,
                text: b.text,
                type: b.type,
                ttl: b.expiresAt - Date.now(),
              })),
              currentTask: state.currentTask,
              taskProgress: state.taskProgress,
            }
          }));
        } catch {
          // Ignore send errors
        }
      }
      break;
    default:
      // Silently ignore unknown message types
      break;
  }
}

export function broadcast(message: WebSocketMessage): void {
  if (!wss) return;

  const payload = JSON.stringify(message);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch {
        clients.delete(client);
      }
    }
  }
}
