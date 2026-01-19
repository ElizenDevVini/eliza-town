// Eliza Town Server - Static files + optional orchestration backend
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

// Try to load dotenv, but don't fail if it doesn't exist
try {
  await import('dotenv/config');
} catch (e) {
  // dotenv not available or no .env file - that's fine in production
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const app = express();
const server = createServer(app);

const PORT = process.env.PORT || 3000;

// Track if database is available
let dbAvailable = false;
let orchestrationReady = false;

// Global error handlers to prevent crashes
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Middleware
app.use(cors());
app.use(express.json());

// Health check (always works)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    dbAvailable,
    orchestrationReady,
    timestamp: Date.now()
  });
});

// Static files (serve the 3D town frontend) - this should always work
app.use(express.static(rootDir, {
  extensions: ['html', 'js', 'css', 'json', 'png', 'jpg', 'glb', 'gltf', 'bin'],
  setHeaders: (res, filepath) => {
    // Set correct MIME types for 3D assets
    if (filepath.endsWith('.gltf')) {
      res.setHeader('Content-Type', 'model/gltf+json');
    } else if (filepath.endsWith('.glb')) {
      res.setHeader('Content-Type', 'model/gltf-binary');
    } else if (filepath.endsWith('.bin')) {
      res.setHeader('Content-Type', 'application/octet-stream');
    }
  }
}));

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(rootDir, 'index.html'));
});

// Start the server immediately so static files work
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Eliza Town server running on port ${PORT}`);
  console.log('Static file serving is active');
});

// Try to initialize database and orchestration (non-blocking)
async function initializeBackend() {
  // Check if DATABASE_URL is configured
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL not configured - running in static-only mode');
    console.log('Set DATABASE_URL to enable agent orchestration');
    return;
  }

  try {
    console.log('Initializing database...');
    const db = await import('./db/index.js');
    await db.initializeDatabase();
    dbAvailable = true;
    console.log('Database connected');

    // Seed default agents if none exist
    const agents = await db.getAgents();
    if (agents.length === 0) {
      console.log('Seeding default agents...');
      const { DEFAULT_AGENTS } = await import('./agents/config.js');
      for (const agentConfig of DEFAULT_AGENTS) {
        await db.createAgent(
          agentConfig.name,
          agentConfig.type,
          agentConfig.modelId,
          agentConfig.personality,
          agentConfig.capabilities
        );
      }
      console.log(`Created ${DEFAULT_AGENTS.length} default agents`);
    }

    // Initialize WebSocket
    const ws = await import('./websocket/index.js');
    ws.initialize(server);
    console.log('WebSocket server initialized');

    // Mount API routes (now that db is available)
    const { default: apiRoutes } = await import('./api/routes.js');
    app.use('/api', apiRoutes);
    console.log('API routes mounted');

    // Initialize orchestration
    const orchestration = await import('./orchestration/loop.js');
    await orchestration.initialize();
    orchestrationReady = true;

    // Auto-start orchestration loop (only if ANTHROPIC_API_KEY is set)
    if (process.env.ANTHROPIC_API_KEY) {
      orchestration.start(5000);
      console.log('Orchestration loop started (5s interval)');
    } else {
      console.log('ANTHROPIC_API_KEY not set - orchestration loop disabled');
    }

  } catch (error) {
    console.error('Backend initialization error:', error.message);
    console.log('Server will continue serving static files');
  }
}

// Initialize backend asynchronously
initializeBackend();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  if (orchestrationReady) {
    const orchestration = await import('./orchestration/loop.js');
    orchestration.stop();
  }
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
