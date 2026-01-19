import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import * as db from './db/index.js';
import * as ws from './websocket/index.js';
import * as orchestration from './orchestration/loop.js';
import apiRoutes from './api/routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const app = express();
const server = createServer(app);

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// API routes
app.use('/api', apiRoutes);

// Static files (serve the 3D town frontend)
app.use(express.static(rootDir));

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(rootDir, 'index.html'));
});

// Initialize and start
async function start() {
  try {
    // Initialize database
    console.log('Initializing database...');
    await db.initializeDatabase();

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
    ws.initialize(server);

    // Initialize orchestration
    await orchestration.initialize();

    // Start server
    server.listen(PORT, () => {
      console.log(`Eliza Town server running on http://localhost:${PORT}`);
      console.log(`API available at http://localhost:${PORT}/api`);
      console.log(`WebSocket available at ws://localhost:${PORT}/ws`);
    });

    // Auto-start orchestration loop
    orchestration.start(5000);
    console.log('Orchestration loop started (5s interval)');

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  orchestration.stop();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

start();
