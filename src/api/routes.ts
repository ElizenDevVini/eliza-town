import { Router, Request, Response, NextFunction } from 'express';

// Database module - loaded lazily to handle cases where DB isn't configured
let db: typeof import('../db/index.js') | null = null;
let storage: typeof import('../storage/index.js') | null = null;
let dbInitialized = false;

// Initialize database module
async function initDb(): Promise<typeof import('../db/index.js')> {
  if (!db) {
    db = await import('../db/index.js');
  }
  return db;
}

async function initStorage(): Promise<typeof import('../storage/index.js')> {
  if (!storage) {
    storage = await import('../storage/index.js');
  }
  return storage;
}

// Check if database is available (set by server.ts after successful init)
export function setDbAvailable(available: boolean): void {
  dbInitialized = available;
}

// Import the new ElizaOS orchestration (loaded dynamically since it depends on runtime)
let orchestration: typeof import('../eliza/orchestration.js') | null = null;

// Lazy-load orchestration module
async function getOrchestration(): Promise<typeof import('../eliza/orchestration.js')> {
  if (!orchestration) {
    orchestration = await import('../eliza/orchestration.js');
  }
  return orchestration;
}

const router = Router();

// Middleware to check database availability
function requireDb(req: Request, res: Response, next: NextFunction): void {
  if (!dbInitialized) {
    res.status(503).json({
      error: 'Database not available',
      message: 'The server is running in demo mode. Configure DATABASE_URL and an LLM API key to enable full functionality.',
    });
    return;
  }
  next();
}

// Helper to extract session ID from request
function getSessionId(req: Request): string | null {
  return (req.headers['x-session-id'] as string) || null;
}

// Health check
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Date.now(), engine: 'ElizaOS', dbAvailable: dbInitialized });
});

// === Agents ===

router.get('/agents', requireDb, async (_req: Request, res: Response) => {
  try {
    const dbModule = await initDb();
    const agents = await dbModule.getAgents();
    res.json(agents);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/agents/:id', requireDb, async (req: Request, res: Response) => {
  try {
    const dbModule = await initDb();
    const agent = await dbModule.getAgent(parseInt(req.params.id));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json(agent);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/agents/:id/move', requireDb, async (req: Request, res: Response) => {
  try {
    const { hubName } = req.body as { hubName?: string };
    if (!hubName) {
      res.status(400).json({ error: 'hubName is required' });
      return;
    }

    const { triggerAgentDecision, getAllRuntimes, getMetadata } = await import('../eliza/runtimeManager.js');

    const agentId = parseInt(req.params.id);
    const runtimes = getAllRuntimes();
    let targetUsername: string | null = null;

    for (const [username] of runtimes) {
      const meta = getMetadata(username);
      if (meta?.dbId === agentId) {
        targetUsername = username;
        break;
      }
    }

    if (!targetUsername) {
      res.status(404).json({ error: 'Agent not found in ElizaOS runtimes' });
      return;
    }

    const result = await triggerAgentDecision(targetUsername, `Move to ${hubName} now.`);
    res.json({ status: 'move_triggered', result });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.patch('/agents/:id', requireDb, async (req: Request, res: Response) => {
  try {
    const dbModule = await initDb();
    const { name, type, model, personality, capabilities } = req.body as {
      name?: string;
      type?: string;
      model?: string;
      personality?: string;
      capabilities?: string;
    };
    const agent = await dbModule.updateAgent(parseInt(req.params.id), {
      name,
      type,
      model_id: model,
      personality,
      capabilities,
    });
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json(agent);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// === Hubs ===

router.get('/hubs', requireDb, async (_req: Request, res: Response) => {
  try {
    const dbModule = await initDb();
    const hubs = await dbModule.getHubs();
    res.json(hubs);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/hubs/:id', requireDb, async (req: Request, res: Response) => {
  try {
    const dbModule = await initDb();
    const hub = await dbModule.getHub(parseInt(req.params.id));
    if (!hub) {
      res.status(404).json({ error: 'Hub not found' });
      return;
    }
    res.json(hub);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// === Tasks ===

router.get('/tasks', requireDb, async (req: Request, res: Response) => {
  try {
    const dbModule = await initDb();
    const { status } = req.query as { status?: string };
    const sessionId = getSessionId(req);
    const tasks = await dbModule.getTasks(status || null, sessionId);
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/tasks/:id', requireDb, async (req: Request, res: Response) => {
  try {
    const dbModule = await initDb();
    const task = await dbModule.getTask(parseInt(req.params.id));
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/tasks', requireDb, async (req: Request, res: Response) => {
  try {
    const { title, description, priority } = req.body as {
      title?: string;
      description?: string;
      priority?: number;
    };
    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const sessionId = getSessionId(req);
    const orch = await getOrchestration();
    const task = await orch.createTask(title, description || null, priority, sessionId);
    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.patch('/tasks/:id', requireDb, async (req: Request, res: Response) => {
  try {
    const dbModule = await initDb();
    const { status, assignedAgentId } = req.body as {
      status?: string;
      assignedAgentId?: number;
    };
    const task = await dbModule.updateTaskStatus(
      parseInt(req.params.id),
      status || 'pending',
      assignedAgentId || null
    );
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get task files
router.get('/tasks/:id/files', requireDb, async (req: Request, res: Response) => {
  try {
    const storageModule = await initStorage();
    const files = await storageModule.getTaskFiles(parseInt(req.params.id));
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Download a specific task file
router.get('/tasks/:id/files/:filename', requireDb, async (req: Request, res: Response) => {
  try {
    const storageModule = await initStorage();
    const content = await storageModule.getTaskFile(parseInt(req.params.id), req.params.filename);
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
    res.send(content);
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

// === Subtasks ===

router.get('/tasks/:taskId/subtasks', requireDb, async (req: Request, res: Response) => {
  try {
    const dbModule = await initDb();
    const subtasks = await dbModule.getSubtasks(parseInt(req.params.taskId));
    res.json(subtasks);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/tasks/:taskId/subtasks', requireDb, async (req: Request, res: Response) => {
  try {
    const dbModule = await initDb();
    const { title, description, orderIndex } = req.body as {
      title?: string;
      description?: string;
      orderIndex?: number;
    };
    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const subtask = await dbModule.createSubtask(
      parseInt(req.params.taskId),
      title,
      description || null,
      orderIndex || 0
    );
    res.status(201).json(subtask);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// === Messages ===

router.get('/messages', requireDb, async (req: Request, res: Response) => {
  try {
    const dbModule = await initDb();
    const { limit } = req.query as { limit?: string };
    const messages = await dbModule.getRecentMessages(parseInt(limit || '50'));
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/messages', requireDb, async (req: Request, res: Response) => {
  try {
    const dbModule = await initDb();
    const { agentId, type, content, taskId, subtaskId, targetAgentId, hubId } = req.body as {
      agentId?: number;
      type?: string;
      content?: string;
      taskId?: number;
      subtaskId?: number;
      targetAgentId?: number;
      hubId?: string;
    };
    if (!agentId || !type || !content) {
      res.status(400).json({ error: 'agentId, type, and content are required' });
      return;
    }
    const message = await dbModule.createMessage(
      agentId,
      type,
      content,
      taskId || null,
      subtaskId || null,
      targetAgentId || null,
      hubId || null
    );
    res.status(201).json(message);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// === Orchestration ===

router.get('/orchestration/state', requireDb, async (_req: Request, res: Response) => {
  try {
    const orch = await getOrchestration();
    const state = orch.getState();
    res.json(state);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/orchestration/debug', requireDb, async (_req: Request, res: Response) => {
  try {
    const dbModule = await initDb();
    const orch = await getOrchestration();
    const state = orch.getState();
    const agents = await dbModule.getAgents();
    const pendingTasks = await dbModule.getTasks('pending');
    const inProgressTasks = await dbModule.getTasks('in_progress');

    res.json({
      engine: 'ElizaOS',
      stateAgentCount: state.agents.length,
      dbAgentCount: agents.length,
      agents: state.agents.map((a) => ({
        agentId: a.agentId,
        name: a.name,
        role: a.role,
        status: a.status,
        hub: a.hub,
      })),
      dbAgents: agents.map((a) => ({ id: a.id, name: a.name, type: a.type, status: a.status })),
      pendingTaskCount: pendingTasks.length,
      pendingTasks: pendingTasks.map((t) => ({ id: t.id, title: t.title, status: t.status })),
      inProgressTaskCount: inProgressTasks.length,
      inProgressTasks: inProgressTasks.map((t) => ({ id: t.id, title: t.title, status: t.status })),
      activeWork: state.activeWork,
      travelingAgents: state.travelingAgents,
      isRunning: state.isRunning,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/orchestration/start', requireDb, async (req: Request, res: Response) => {
  try {
    const { interval } = req.body as { interval?: number };
    const orch = await getOrchestration();
    orch.start(interval || 5000);
    res.json({ status: 'started', engine: 'ElizaOS' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/orchestration/stop', requireDb, async (_req: Request, res: Response) => {
  try {
    const orch = await getOrchestration();
    orch.stop();
    res.json({ status: 'stopped' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// === ElizaOS-specific endpoints ===

router.post('/agents/:id/decide', requireDb, async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body as { prompt?: string };
    const { triggerAgentDecision, getAllRuntimes, getMetadata } = await import('../eliza/runtimeManager.js');

    const agentId = parseInt(req.params.id);
    const runtimes = getAllRuntimes();
    let targetUsername: string | null = null;

    for (const [username] of runtimes) {
      const meta = getMetadata(username);
      if (meta?.dbId === agentId) {
        targetUsername = username;
        break;
      }
    }

    if (!targetUsername) {
      res.status(404).json({ error: 'Agent not found in ElizaOS runtimes' });
      return;
    }

    const result = await triggerAgentDecision(targetUsername, prompt || 'What do you want to do next?');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/eliza/runtimes', requireDb, async (_req: Request, res: Response) => {
  try {
    const { getAllRuntimes, getMetadata } = await import('../eliza/runtimeManager.js');
    const { getAgentState } = await import('../eliza/elizaTownPlugin.js');

    const runtimes = getAllRuntimes();
    const agents: Array<Record<string, unknown>> = [];

    for (const [agentId] of runtimes) {
      const meta = getMetadata(agentId);
      const state = getAgentState(agentId);
      agents.push({
        agentId,
        ...meta,
        ...state,
      });
    }

    res.json({ engine: 'ElizaOS', agents });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// === Demo Mode ===

router.get('/demo/status', async (_req: Request, res: Response) => {
  try {
    const { getDemoStatus } = await import('../eliza/demoMode.js');
    const status = getDemoStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/demo/start', async (_req: Request, res: Response) => {
  try {
    const { startDemoMode } = await import('../eliza/demoMode.js');
    const ws = await import('../websocket/index.js');
    const success = await startDemoMode(ws.broadcast);
    res.json({
      success,
      message: success ? 'Demo mode started' : 'Failed to start demo mode (check DEMO_MODE=true)',
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/demo/stop', async (_req: Request, res: Response) => {
  try {
    const { stopDemoMode } = await import('../eliza/demoMode.js');
    stopDemoMode();
    res.json({ success: true, message: 'Demo mode stopped' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// === Code Execution (Sub-Agent) ===

router.get('/execution/config', (_req: Request, res: Response) => {
  res.json({
    mode: process.env.USE_E2B === 'true' ? 'e2b-sandbox' : 'local',
    coderEnabled: process.env.CODER_ENABLED === 'true',
    workingDirectory: process.env.CODER_ALLOWED_DIRECTORY || process.cwd(),
    demoMode: process.env.DEMO_MODE === 'true',
    e2bConfigured: !!process.env.E2B_API_KEY,
  });
});

router.post('/execution/run', requireDb, async (req: Request, res: Response) => {
  try {
    const { taskName, taskDescription } = req.body as {
      taskName?: string;
      taskDescription?: string;
    };

    if (!taskName) {
      res.status(400).json({ error: 'taskName is required' });
      return;
    }

    // Check if code execution is enabled
    if (process.env.CODER_ENABLED !== 'true') {
      res.status(403).json({
        error: 'Code execution not enabled',
        hint: 'Set CODER_ENABLED=true to enable',
      });
      return;
    }

    const { triggerAgentDecision, getAllRuntimes } = await import('../eliza/runtimeManager.js');
    const { getSharedSandbox } = await import('../eliza/sharedSandbox.js');

    // Find an available coder agent
    const runtimes = getAllRuntimes();
    let coderAgentId: string | null = null;

    for (const [agentId] of runtimes) {
      if (agentId.includes('coder')) {
        coderAgentId = agentId;
        break;
      }
    }

    if (!coderAgentId) {
      res.status(500).json({ error: 'No coder agent available' });
      return;
    }

    // Trigger the coder agent with the task (uses canonical handleMessage pattern)
    const prompt = `
Execute this coding task in the shared codebase:

Task: ${taskName}
Description: ${taskDescription || taskName}

WORKFLOW:
1. Use LIST_FILES to explore the codebase
2. Use READ_FILE to examine relevant code
3. Use WRITE_FILE or EDIT_FILE to implement the solution
4. Use EXECUTE_SHELL to run tests
5. Use SPEAK to announce completion

Write complete, working code.
`;

    const result = await triggerAgentDecision(coderAgentId, prompt);

    // Get sandbox state for response
    const sandbox = getSharedSandbox();
    const recentChanges = sandbox.getRecentChanges(10);

    res.json({
      success: result?.didRespond || false,
      agentId: coderAgentId,
      response: result?.text || '',
      thought: result?.thought || '',
      actions: result?.actions || [],
      filesChanged: recentChanges.map((c) => ({
        type: c.type,
        filepath: c.filepath,
        agent: c.agent,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
