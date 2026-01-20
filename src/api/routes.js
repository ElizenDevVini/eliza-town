import { Router } from 'express';
import * as db from '../db/index.js';
import * as orchestration from '../orchestration/loop.js';
import * as storage from '../storage/index.js';

const router = Router();

// Helper to extract session ID from request
function getSessionId(req) {
  return req.headers['x-session-id'] || null;
}

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// === Agents ===

router.get('/agents', async (req, res) => {
  try {
    const agents = await db.getAgents();
    res.json(agents);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/agents/:id', async (req, res) => {
  try {
    const agent = await db.getAgent(parseInt(req.params.id));
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json(agent);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/agents/:id/move', async (req, res) => {
  try {
    const { hubName } = req.body;
    if (!hubName) {
      return res.status(400).json({ error: 'hubName is required' });
    }
    const result = await orchestration.moveAgentToHub(parseInt(req.params.id), hubName);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === Hubs ===

router.get('/hubs', async (req, res) => {
  try {
    const hubs = await db.getHubs();
    res.json(hubs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/hubs/:id', async (req, res) => {
  try {
    const hub = await db.getHub(parseInt(req.params.id));
    if (!hub) {
      return res.status(404).json({ error: 'Hub not found' });
    }
    res.json(hub);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === Tasks ===

router.get('/tasks', async (req, res) => {
  try {
    const { status } = req.query;
    const sessionId = getSessionId(req);
    const tasks = await db.getTasks(status || null, sessionId);
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/tasks/:id', async (req, res) => {
  try {
    const task = await db.getTask(parseInt(req.params.id));
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/tasks', async (req, res) => {
  try {
    const { title, description, priority } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }
    const sessionId = getSessionId(req);
    const task = await orchestration.createTask(title, description, priority, sessionId);
    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/tasks/:id', async (req, res) => {
  try {
    const { status, assignedAgentId } = req.body;
    const task = await db.updateTaskStatus(
      parseInt(req.params.id),
      status,
      assignedAgentId
    );
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get task files
router.get('/tasks/:id/files', async (req, res) => {
  try {
    const files = await storage.getTaskFiles(parseInt(req.params.id));
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Download a specific task file
router.get('/tasks/:id/files/:filename', async (req, res) => {
  try {
    const content = await storage.getTaskFile(parseInt(req.params.id), req.params.filename);
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
    res.send(content);
  } catch (error) {
    res.status(404).json({ error: 'File not found' });
  }
});

// === Subtasks ===

router.get('/tasks/:taskId/subtasks', async (req, res) => {
  try {
    const subtasks = await db.getSubtasks(parseInt(req.params.taskId));
    res.json(subtasks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/tasks/:taskId/subtasks', async (req, res) => {
  try {
    const { title, description, orderIndex } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }
    const subtask = await db.createSubtask(
      parseInt(req.params.taskId),
      title,
      description,
      orderIndex || 0
    );
    res.status(201).json(subtask);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === Messages ===

router.get('/messages', async (req, res) => {
  try {
    const { limit } = req.query;
    const messages = await db.getRecentMessages(parseInt(limit) || 50);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/messages', async (req, res) => {
  try {
    const { agentId, type, content, taskId, subtaskId, targetAgentId, hubId } = req.body;
    if (!agentId || !type || !content) {
      return res.status(400).json({ error: 'agentId, type, and content are required' });
    }
    const message = await db.createMessage(
      agentId,
      type,
      content,
      taskId,
      subtaskId,
      targetAgentId,
      hubId
    );
    res.status(201).json(message);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === Orchestration ===

router.get('/orchestration/state', (req, res) => {
  try {
    const state = orchestration.getState();
    res.json(state);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint to check orchestration status
router.get('/orchestration/debug', async (req, res) => {
  try {
    const state = orchestration.getState();
    const agents = await db.getAgents();
    const pendingTasks = await db.getTasks('pending');
    const inProgressTasks = await db.getTasks('in_progress');

    res.json({
      stateAgentCount: state.agents.length,
      dbAgentCount: agents.length,
      agents: agents.map(a => ({ id: a.id, name: a.name, type: a.type, status: a.status })),
      pendingTaskCount: pendingTasks.length,
      pendingTasks: pendingTasks.map(t => ({ id: t.id, title: t.title, status: t.status })),
      inProgressTaskCount: inProgressTasks.length,
      inProgressTasks: inProgressTasks.map(t => ({ id: t.id, title: t.title, status: t.status })),
      activeWork: state.activeWork,
      travelingAgents: state.travelingAgents
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/orchestration/start', (req, res) => {
  try {
    const { interval } = req.body;
    orchestration.start(interval || 5000);
    res.json({ status: 'started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/orchestration/stop', (req, res) => {
  try {
    orchestration.stop();
    res.json({ status: 'stopped' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
