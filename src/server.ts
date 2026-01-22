// Eliza Town Server - Static files + ElizaOS orchestration backend
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import * as ws from './websocket/index.js';
import { startVisualDemo, stopVisualDemo, isVisualDemoRunning, getDemoState } from './eliza/visualDemo.js';
import apiRoutes, { setDbAvailable } from './api/routes.js';

import type { HealthResponse } from './types/index.js';

// Try to load dotenv, but don't fail if it doesn't exist
try {
  await import('dotenv/config');
} catch {
  // dotenv not available or no .env file - that's fine in production
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const app = express();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const server = createServer(app as any);

const PORT = process.env.PORT || 3000;

// Track initialization status
let dbAvailable = false;
let orchestrationReady = false;
let wsInitialized = false;
let visualDemoActive = false;
let dbError: Error | null = null;
let orchestrationModule: typeof import('./eliza/orchestration.js') | null = null;

// Global error handlers to prevent crashes
process.on('uncaughtException', (err: Error) => {
  console.error('Uncaught Exception:', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Middleware
app.use(cors());
app.use(express.json());

// Health check (always works)
app.get('/api/health', (_req, res) => {
  const response: HealthResponse = {
    status: 'ok',
    dbAvailable,
    orchestrationReady,
    wsInitialized,
    visualDemoActive,
    dbError: dbError ? dbError.message : null,
    hasDbUrl: !!process.env.DATABASE_URL,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    hasGroqKey: !!process.env.GROQ_API_KEY,
    engine: 'ElizaOS',
    timestamp: Date.now(),
  };
  res.json(response);
});

// Demo state endpoint (for new clients to get current state)
app.get('/api/demo/state', (_req, res) => {
  if (isVisualDemoRunning()) {
    res.json({ running: true, state: getDemoState() });
  } else {
    res.json({ running: false, state: null });
  }
});

// Determine if we have a built client
const clientDistPath = path.join(rootDir, 'dist', 'client');
const hasBuiltClient = fs.existsSync(clientDistPath);

if (hasBuiltClient) {
  // Serve built React app in production
  console.log('Serving built React client from dist/client');
  app.use(express.static(clientDistPath));
} else {
  // Serve legacy index.html for development without client build
  console.log('No built client found - serving legacy index.html');
}

// Always serve assets (3D models, textures, etc.)
app.use(
  '/assets',
  express.static(path.join(rootDir, 'assets'), {
    extensions: ['png', 'jpg', 'glb', 'gltf', 'bin', 'fbx'],
    setHeaders: (res, filepath) => {
      // Set correct MIME types for 3D assets
      if (filepath.endsWith('.gltf')) {
        res.setHeader('Content-Type', 'model/gltf+json');
      } else if (filepath.endsWith('.glb')) {
        res.setHeader('Content-Type', 'model/gltf-binary');
      } else if (filepath.endsWith('.bin')) {
        res.setHeader('Content-Type', 'application/octet-stream');
      }
    },
  })
);

// Mount API routes immediately (they will handle db availability checks internally)

// Export db status check function for routes to use
export function isDatabaseAvailable(): boolean {
  return dbAvailable;
}

// Middleware to check database availability for routes that need it
export function requireDatabase(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!dbAvailable) {
    res.status(503).json({
      error: 'Database not available',
      message: 'The server is running in static-only mode. Configure DATABASE_URL to enable this feature.',
      dbError: dbError ? dbError.message : null,
    });
    return;
  }
  next();
}

app.use('/api', apiRoutes);

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
    return next();
  }

  if (hasBuiltClient) {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  } else {
    res.sendFile(path.join(rootDir, 'index.html'));
  }
});

// Initialize WebSocket BEFORE server starts listening
ws.initialize(server);
wsInitialized = true;

// Start the server immediately so static files work
server.listen(PORT, () => {
  console.log(`Eliza Town server running on port ${PORT}`);
  console.log('Static file serving is active');
  console.log('WebSocket ready on /ws');
});

// Initialize backend with ElizaOS
async function initializeBackend(): Promise<void> {
  // Check for at least one LLM provider - this is REQUIRED for real ElizaOS
  const hasProvider =
    process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GROQ_API_KEY;
  
  if (!hasProvider) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('WARNING: No LLM API key configured!');
    console.log('Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GROQ_API_KEY for real AI agents.');
    console.log('Starting visual demo mode (scripted simulation, no actual AI)...');
    console.log('═══════════════════════════════════════════════════════════════');
    startVisualDemo(ws.broadcast);
    visualDemoActive = true;
    return;
  }

  // We have an LLM provider - use REAL ElizaOS
  const hasDatabase = !!process.env.DATABASE_URL;
  
  try {
    let db: typeof import('./db/index.js') | null = null;
    
    if (hasDatabase) {
      console.log('Initializing PostgreSQL database...');
      db = await import('./db/index.js');
      await db.initializeDatabase();
      dbAvailable = true;
      setDbAvailable(true);
      console.log('✓ PostgreSQL database connected');

      // Seed default agents if none exist
      const agents = await db.getAgents();
      if (agents.length === 0) {
        console.log('Seeding default agents from ElizaOS characters...');
        const { ELIZA_TOWN_CHARACTERS } = await import('./eliza/characters.js');
        for (const character of ELIZA_TOWN_CHARACTERS) {
          await db.createAgent(
            character.name,
            character.role,
            character.modelId,
            character.adjectives?.join(', ') || 'helpful',
            character.capabilities?.join(', ') || 'general'
          );
        }
        console.log(`Created ${ELIZA_TOWN_CHARACTERS.length} default agents`);
      }
    } else {
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('No DATABASE_URL configured - using ElizaOS with in-memory storage');
      console.log('Note: Agent state will not persist across restarts.');
      console.log('Set DATABASE_URL for persistent storage.');
      console.log('═══════════════════════════════════════════════════════════════');
    }

    // Initialize REAL ElizaOS orchestration (with or without PostgreSQL)
    console.log('Initializing ElizaOS with REAL agent runtimes...');
    orchestrationModule = await import('./eliza/orchestration.js');
    const storage = await import('./storage/index.js');

    await orchestrationModule.initialize({
      db: db,  // null if no DATABASE_URL - runtimeManager will use inmemorydb plugin
      broadcast: ws.broadcast,
      storage: storage,
    });

    orchestrationReady = true;

    // Log active providers
    const providers: string[] = [];
    if (process.env.OPENAI_API_KEY) providers.push('OpenAI');
    if (process.env.ANTHROPIC_API_KEY) providers.push('Anthropic');
    if (process.env.GROQ_API_KEY) providers.push('Groq');

    // Start the orchestration loop
    orchestrationModule.start(5000);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✓ ElizaOS orchestration loop started (5s interval)');
    console.log(`✓ Active LLM providers: ${providers.join(', ')}`);
    console.log(`✓ Database: ${hasDatabase ? 'PostgreSQL' : 'In-Memory (ElizaOS inmemorydb)'}`);
    console.log('✓ REAL AI agents are now running!');
    console.log('═══════════════════════════════════════════════════════════════');
  } catch (error) {
    dbError = error as Error;
    console.error('═══════════════════════════════════════════════════════════════');
    console.error('Backend initialization error:', (error as Error).message);
    console.error('Full error:', error);
    console.error('Falling back to visual demo mode (no AI)...');
    console.error('═══════════════════════════════════════════════════════════════');
    
    // Fall back to visual demo on error
    startVisualDemo(ws.broadcast);
    visualDemoActive = true;
  }
}

// Initialize backend asynchronously
initializeBackend();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  if (orchestrationReady && orchestrationModule) {
    orchestrationModule.stop();
  }
  if (visualDemoActive) {
    stopVisualDemo();
  }
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  if (orchestrationReady && orchestrationModule) {
    orchestrationModule.stop();
  }
  if (visualDemoActive) {
    stopVisualDemo();
  }
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
