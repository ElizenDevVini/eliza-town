import { Router } from 'express';
import * as db from '../db/index.js';
import * as orchestration from '../orchestration/loop.js';
import * as storage from '../storage/index.js';
import { chatWithUser } from '../agents/claude.js';
import * as oauth from '../services/oauth.js';

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

// Update agent properties
router.patch('/agents/:id', async (req, res) => {
  try {
    const { name, type, model, personality, capabilities } = req.body;
    const agent = await db.updateAgent(parseInt(req.params.id), {
      name,
      type,
      model_id: model,
      personality,
      capabilities
    });
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json(agent);
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

// === Session Management ===

// Clear tasks for a session (or orphaned tasks without session)
router.delete('/tasks/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await db.clearSessionTasks(sessionId);
    res.json({ cleared: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear all orphaned tasks (no session_id or old sessions)
router.post('/tasks/cleanup', async (req, res) => {
  try {
    const result = await db.cleanupOrphanedTasks();
    res.json({ cleared: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === Agent Chat ===

router.post('/chat', async (req, res) => {
  try {
    const { message, agentEnergies } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    const agents = await db.getAgents();
    const responses = await chatWithUser(agents, message, agentEnergies || {});

    res.json({ responses });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// === OAuth Integrations ===

// Get configured OAuth providers
router.get('/oauth/providers', (req, res) => {
  const providers = oauth.getConfiguredProviders();
  const providerInfo = {
    slack: { name: 'Slack', icon: 'slack', configured: oauth.isConfigured('slack') },
    gmail: { name: 'Gmail', icon: 'mail', configured: oauth.isConfigured('gmail') }
  };
  res.json(providerInfo);
});

// Get connected integrations for current session
router.get('/oauth/connected', async (req, res) => {
  try {
    const sessionId = getSessionId(req);
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }
    const integrations = await oauth.getConnectedIntegrations(sessionId);
    res.json(integrations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start OAuth flow
router.get('/oauth/:provider/auth', (req, res) => {
  const { provider } = req.params;
  const sessionId = req.query.session_id;

  if (!sessionId) {
    return res.status(400).json({ error: 'session_id query parameter required' });
  }

  if (!oauth.isConfigured(provider)) {
    return res.status(400).json({ error: `${provider} OAuth not configured` });
  }

  const redirectUri = `${req.protocol}://${req.get('host')}/api/oauth/${provider}/callback`;
  const authUrl = oauth.getAuthUrl(provider, sessionId, redirectUri);

  res.redirect(authUrl);
});

// OAuth callback
router.get('/oauth/:provider/callback', async (req, res) => {
  const { provider } = req.params;
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`/?oauth_error=${encodeURIComponent(error)}`);
  }

  try {
    const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    const { sessionId } = stateData;

    const redirectUri = `${req.protocol}://${req.get('host')}/api/oauth/${provider}/callback`;
    const tokenData = await oauth.exchangeCode(provider, code, redirectUri);

    await oauth.saveToken(sessionId, provider, tokenData);

    res.redirect(`/?oauth_success=${provider}`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(`/?oauth_error=${encodeURIComponent(err.message)}`);
  }
});

// Disconnect OAuth provider
router.delete('/oauth/:provider', async (req, res) => {
  try {
    const { provider } = req.params;
    const sessionId = getSessionId(req);

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }

    await oauth.disconnect(sessionId, provider);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === Slack Actions ===

router.post('/slack/send', async (req, res) => {
  try {
    const sessionId = getSessionId(req);
    const { channel, text } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }
    if (!channel || !text) {
      return res.status(400).json({ error: 'channel and text required' });
    }

    const result = await oauth.sendSlackMessage(sessionId, channel, text);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/slack/channels', async (req, res) => {
  try {
    const sessionId = getSessionId(req);
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }

    const channels = await oauth.getSlackChannels(sessionId);
    res.json(channels);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === Gmail Actions ===

router.post('/gmail/send', async (req, res) => {
  try {
    const sessionId = getSessionId(req);
    const { to, subject, body } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'to, subject, and body required' });
    }

    const result = await oauth.sendGmail(sessionId, to, subject, body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/gmail/messages', async (req, res) => {
  try {
    const sessionId = getSessionId(req);
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }

    const maxResults = parseInt(req.query.limit) || 10;
    const messages = await oauth.getGmailMessages(sessionId, maxResults);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
