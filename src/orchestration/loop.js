import * as db from '../db/index.js';
import * as claude from '../agents/claude.js';
import { AGENT_TYPES, getAgentConfig } from '../agents/config.js';
import { broadcast, getActiveSessions } from '../websocket/index.js';
import * as storage from '../storage/index.js';

let isRunning = false;
let loopInterval = null;

// Hub definitions matching the frontend
const HUBS = {
  town_square: { x: 0, z: 0, name: 'Town Square' },
  planning_room: { x: -18, z: -15, name: 'Planning Room' },
  design_studio: { x: 18, z: -15, name: 'Design Studio' },
  coding_desk: { x: -18, z: 15, name: 'Coding Desk' },
  review_station: { x: 18, z: 15, name: 'Review Station' },
  deploy_station: { x: 0, z: -25, name: 'Deploy Station' },
};

// Map agent types to their work hubs
const AGENT_WORK_HUBS = {
  planner: 'planning_room',
  designer: 'design_studio',
  coder: 'coding_desk',
  reviewer: 'review_station'
};

// Orchestration state
const state = {
  agents: new Map(),
  activeWork: new Map(), // agentId -> { taskId, subtaskId, startedAt }
  travelingAgents: new Map(), // agentId -> { targetHub, arrivalTime }
  agentHubs: new Map() // agentId -> current hub name
};

export async function initialize() {
  // Load agents into state
  const agents = await db.getAgents();
  for (const agent of agents) {
    state.agents.set(agent.id, agent);
    console.log(`  Loaded agent: ${agent.name} (${agent.type}) status=${agent.status}`);
  }
  console.log(`Orchestration initialized with ${agents.length} agents`);
}

export function start(intervalMs = 2000) {
  if (isRunning) return;
  isRunning = true;
  loopInterval = setInterval(tick, intervalMs);
  console.log('Orchestration loop started (interval: ' + intervalMs + 'ms)');
}

export function stop() {
  if (!isRunning) return;
  isRunning = false;
  clearInterval(loopInterval);
  console.log('Orchestration loop stopped');
}

async function tick() {
  try {
    // Debug logging
    const allAgents = [...state.agents.values()];
    console.log(`[TICK] Agents in state: ${allAgents.length}`);
    if (allAgents.length > 0) {
      console.log(`[TICK] Agent statuses: ${allAgents.map(a => `${a.name}(${a.type}):${a.status}`).join(', ')}`);
    }

    // Update traveling agents
    await updateTravelingAgents();

    // Get active sessions - only process tasks from active WebSocket connections
    const activeSessions = getActiveSessions();
    console.log(`[TICK] Active sessions: ${activeSessions.length}`);

    // Check for pending tasks - filter to only active sessions
    const allPendingTasks = await db.getTasks('pending');
    const pendingTasks = allPendingTasks.filter(t =>
      t.session_id && activeSessions.includes(t.session_id)
    );
    console.log(`[TICK] Pending tasks (active sessions): ${pendingTasks.length} of ${allPendingTasks.length}`);

    // Find idle planner agents
    const planners = [...state.agents.values()].filter(
      a => a.type === 'planner' && a.status === 'idle'
    );
    console.log(`[TICK] Idle planners: ${planners.length}`);

    // Assign pending tasks to planners for breakdown
    for (const task of pendingTasks) {
      console.log(`[TICK] Processing pending task: "${task.title}" (id: ${task.id})`);
      if (planners.length === 0) {
        console.log('[TICK] No idle planners available');
        break;
      }
      const planner = planners.shift();
      console.log(`[TICK] Assigning to planner: ${planner.name}`);
      await assignTaskToPlanner(planner, task);
    }

    // Process in-progress tasks - also filter by active sessions
    const allInProgressTasks = await db.getTasks('in_progress');
    const inProgressTasks = allInProgressTasks.filter(t =>
      t.session_id && activeSessions.includes(t.session_id)
    );
    for (const task of inProgressTasks) {
      await processTask(task);
    }

    // Generate ambient activity (thoughts, chats)
    await generateAmbientActivity();

    // Broadcast state update to all clients
    await broadcastState();
  } catch (error) {
    console.error('Orchestration tick error:', error);
  }
}

async function assignTaskToPlanner(planner, task) {
  console.log(`Assigning task "${task.title}" to planner ${planner.name}`);

  // Move planner to planning room
  await moveAgentToHubWithEvent(planner, 'planning_room');

  // Update planner status
  await db.updateAgentStatus(planner.id, 'working');
  state.agents.get(planner.id).status = 'working';

  // Emit status change
  broadcast({
    type: 'agent_status',
    data: { agent: planner.name, agentId: planner.id, status: 'working', doing: 'Analyzing task' }
  });

  // Emit speech
  broadcast({
    type: 'agent_speak',
    data: { agent: planner.name, agentId: planner.id, text: `Let me break down: "${task.title}"`, type: 'saying' }
  });

  // Update task status
  await db.updateTaskStatus(task.id, 'in_progress', planner.id);

  // Create working message
  await db.createMessage(
    planner.id,
    'status',
    `Starting to analyze task: ${task.title}`,
    task.id
  );

  // Call Claude to analyze the task
  const result = await claude.analyzeTask(planner.id, task);

  if (result.success) {
    try {
      const analysis = JSON.parse(result.content);

      // Emit thinking
      broadcast({
        type: 'agent_think',
        data: { agent: planner.name, agentId: planner.id, text: analysis.analysis?.substring(0, 100) || 'Analyzing...' }
      });

      // Create subtasks
      if (analysis.subtasks && Array.isArray(analysis.subtasks)) {
        for (let i = 0; i < analysis.subtasks.length; i++) {
          const st = analysis.subtasks[i];
          await db.createSubtask(task.id, st.title, st.description, st.order || i);
        }

        // Announce the plan
        broadcast({
          type: 'agent_speak',
          data: {
            agent: planner.name,
            agentId: planner.id,
            text: `Alright, ${analysis.subtasks.length} steps. Let's go team!`,
            type: 'saying'
          }
        });
      }

      // Log the analysis
      await db.createMessage(
        planner.id,
        'thought',
        `Analysis complete. Created ${analysis.subtasks?.length || 0} subtasks. Complexity: ${analysis.estimatedComplexity}`,
        task.id
      );
    } catch (parseError) {
      console.error('Failed to parse planner response:', parseError);
      await db.createMessage(planner.id, 'thought', 'Had trouble structuring the analysis...', task.id);
    }
  }

  // Return planner to idle at town square
  await moveAgentToHubWithEvent(planner, 'town_square');
  await db.updateAgentStatus(planner.id, 'idle');
  state.agents.get(planner.id).status = 'idle';

  broadcast({
    type: 'agent_status',
    data: { agent: planner.name, agentId: planner.id, status: 'idle', doing: '' }
  });
}

async function processTask(task) {
  const subtasks = await db.getSubtasks(task.id);

  // Find next pending subtask
  const pendingSubtask = subtasks.find(st => st.status === 'pending');

  if (!pendingSubtask) {
    // Check if all subtasks are completed
    const allCompleted = subtasks.every(st => st.status === 'completed');
    if (allCompleted && subtasks.length > 0) {
      await db.updateTaskStatus(task.id, 'completed');
      await db.createMessage(
        task.assigned_agent_id,
        'announcement',
        `Task "${task.title}" has been completed!`,
        task.id
      );

      // Emit task complete event
      broadcast({
        type: 'task_complete',
        data: {
          taskId: task.id,
          result: {
            downloadUrl: `/api/tasks/${task.id}/download`,
            previewUrl: `/api/tasks/${task.id}/preview`
          }
        }
      });
    }
    return;
  }

  // Find an idle agent of the appropriate type
  const subtaskType = determineSubtaskType(pendingSubtask);
  const availableAgent = [...state.agents.values()].find(
    a => a.type === subtaskType && a.status === 'idle'
  );

  if (!availableAgent) return;

  // Assign and execute subtask
  await executeSubtask(availableAgent, task, pendingSubtask);
}

function determineSubtaskType(subtask) {
  const title = subtask.title.toLowerCase();
  const desc = (subtask.description || '').toLowerCase();

  if (title.includes('design') || title.includes('architect') || desc.includes('design')) {
    return 'designer';
  }
  if (title.includes('review') || title.includes('test') || desc.includes('review')) {
    return 'reviewer';
  }
  if (title.includes('plan') || title.includes('coordinate') || desc.includes('plan')) {
    return 'planner';
  }
  return 'coder';
}

async function executeSubtask(agent, task, subtask) {
  console.log(`Agent ${agent.name} starting subtask: ${subtask.title}`);

  // Move agent to their work hub
  const workHub = AGENT_WORK_HUBS[agent.type] || 'town_square';
  await moveAgentToHubWithEvent(agent, workHub);

  // Update statuses
  await db.updateAgentStatus(agent.id, 'working');
  state.agents.get(agent.id).status = 'working';
  await db.updateSubtaskStatus(subtask.id, 'in_progress');

  // Emit status and speech
  broadcast({
    type: 'agent_status',
    data: { agent: agent.name, agentId: agent.id, status: 'working', doing: subtask.title }
  });

  broadcast({
    type: 'agent_speak',
    data: { agent: agent.name, agentId: agent.id, text: `Working on: ${subtask.title}`, type: 'saying' }
  });

  // Create status message
  await db.createMessage(
    agent.id,
    'status',
    `Working on: ${subtask.title}`,
    task.id,
    subtask.id
  );

  // Get agent config and execute appropriate action
  const config = getAgentConfig(agent.type);
  let result;

  switch (agent.type) {
    case 'designer':
      broadcast({
        type: 'agent_think',
        data: { agent: agent.name, agentId: agent.id, text: 'Considering design options...' }
      });
      result = await claude.designSolution(agent.id, task, subtask);
      break;
    case 'coder':
      broadcast({
        type: 'agent_think',
        data: { agent: agent.name, agentId: agent.id, text: 'Writing code...' }
      });
      result = await claude.implementCode(agent.id, task, subtask);
      break;
    case 'reviewer':
      broadcast({
        type: 'agent_think',
        data: { agent: agent.name, agentId: agent.id, text: 'Reviewing changes...' }
      });
      result = await claude.reviewCode(agent.id, task, subtask, subtask.description);
      break;
    default:
      result = await claude.analyzeTask(agent.id, task);
  }

  if (result.success) {
    await db.updateSubtaskStatus(subtask.id, 'completed', result.content);
    await db.createMessage(
      agent.id,
      'thought',
      `Completed: ${subtask.title}`,
      task.id,
      subtask.id
    );

    // Emit completion speech
    broadcast({
      type: 'agent_speak',
      data: { agent: agent.name, agentId: agent.id, text: `Done with ${subtask.title}!`, type: 'saying' }
    });

    // Save output files for coder
    if (agent.type === 'coder' && result.content) {
      try {
        const savedFiles = await storage.saveCoderOutput(task.id, result.content);
        for (const file of savedFiles) {
          broadcast({
            type: 'file_created',
            data: { taskId: task.id, filename: file.name, size: file.size }
          });
        }
        console.log(`Saved ${savedFiles.length} files for task ${task.id}`);
      } catch (e) {
        console.error('Failed to save coder output:', e);
      }
    }

    // Save output for designer and reviewer too
    if ((agent.type === 'designer' || agent.type === 'reviewer') && result.content) {
      try {
        const filename = agent.type === 'designer' ? 'design.json' : 'review.json';
        await storage.saveTaskFile(task.id, filename, result.content);
        broadcast({
          type: 'file_created',
          data: { taskId: task.id, filename, size: result.content.length }
        });
      } catch (e) {
        console.error('Failed to save output:', e);
      }
    }
  } else {
    await db.createMessage(
      agent.id,
      'thought',
      `Encountered an issue with: ${subtask.title}`,
      task.id,
      subtask.id
    );

    broadcast({
      type: 'agent_speak',
      data: { agent: agent.name, agentId: agent.id, text: 'Hmm, ran into an issue...', type: 'saying' }
    });
  }

  // Return agent to town square
  await moveAgentToHubWithEvent(agent, 'town_square');

  // Update status to idle
  await db.updateAgentStatus(agent.id, 'idle');
  state.agents.get(agent.id).status = 'idle';

  broadcast({
    type: 'agent_status',
    data: { agent: agent.name, agentId: agent.id, status: 'idle', doing: '' }
  });
}

async function updateTravelingAgents() {
  const now = Date.now();

  for (const [agentId, travel] of state.travelingAgents) {
    if (now >= travel.arrivalTime) {
      const agent = state.agents.get(agentId);
      const hubName = travel.targetHub;
      const hub = HUBS[hubName];

      if (agent && hub) {
        state.agentHubs.set(agentId, hubName);

        // Emit arrival event
        broadcast({
          type: 'agent_arrived',
          data: { agent: agent.name, agentId: agentId, hub: hubName }
        });

        await db.createMessage(agentId, 'status', `Arrived at ${hub.name}`);
      }

      state.travelingAgents.delete(agentId);
    }
  }
}

// Helper to move agent to hub with WebSocket events
async function moveAgentToHubWithEvent(agent, targetHub) {
  const currentHub = state.agentHubs.get(agent.id) || 'town_square';
  const hub = HUBS[targetHub];

  if (!hub || currentHub === targetHub) return;

  // Calculate travel time based on distance (faster for better UX)
  const currentPos = HUBS[currentHub] || HUBS.town_square;
  const distance = Math.sqrt(
    Math.pow(hub.x - currentPos.x, 2) +
    Math.pow(hub.z - currentPos.z, 2)
  );
  const travelTime = Math.max(500, distance * 30); // min 0.5s, 30ms per unit (fast)

  // Emit move event
  broadcast({
    type: 'agent_move',
    data: {
      agent: agent.name,
      agentId: agent.id,
      from: currentPos,
      to: { x: hub.x, z: hub.z },
      hub: targetHub
    }
  });

  // Track traveling state
  state.travelingAgents.set(agent.id, {
    targetHub: targetHub,
    arrivalTime: Date.now() + travelTime
  });

  // Wait for arrival (simplified - in real system would be event-driven)
  await new Promise(resolve => setTimeout(resolve, travelTime + 200));

  state.agentHubs.set(agent.id, targetHub);
}

async function generateAmbientActivity() {
  // Randomly generate thoughts or chats for idle agents
  const idleAgents = [...state.agents.values()].filter(a => a.status === 'idle');

  if (idleAgents.length === 0) return;

  // 10% chance per tick for ambient activity
  if (Math.random() > 0.1) return;

  const agent = idleAgents[Math.floor(Math.random() * idleAgents.length)];
  const currentHub = state.agentHubs.get(agent.id) || 'town_square';

  // 70% thoughts, 30% chats
  if (Math.random() < 0.7) {
    const thought = await claude.generateThought(
      agent.id,
      agent.type,
      `Agent ${agent.name} is idle in ${HUBS[currentHub]?.name || 'the town'}`
    );
    if (thought) {
      await db.createMessage(agent.id, 'thought', thought);
      // Emit thought bubble
      broadcast({
        type: 'agent_think',
        data: { agent: agent.name, agentId: agent.id, text: thought }
      });
    }
  } else if (idleAgents.length > 1) {
    const otherAgents = idleAgents.filter(a => a.id !== agent.id);
    const target = otherAgents[Math.floor(Math.random() * otherAgents.length)];
    const chat = await claude.generateChat(agent.id, agent.type, target.name, 'work and projects');
    if (chat) {
      await db.createMessage(agent.id, 'chat', chat, null, null, target.id);
      // Emit speech bubble for chat
      broadcast({
        type: 'agent_speak',
        data: { agent: agent.name, agentId: agent.id, text: chat, type: 'saying', toAgent: target.name }
      });
    }
  }
}

async function broadcastState() {
  const agents = await db.getAgents();
  const tasks = await db.getTasks();
  const messages = await db.getRecentMessages(20);

  broadcast({
    type: 'state_update',
    data: {
      agents,
      tasks,
      messages,
      timestamp: Date.now()
    }
  });
}

// Public methods for manual control
export async function createTask(title, description, priority = 5, sessionId = null) {
  const task = await db.createTask(title, description, priority, sessionId);

  broadcast({
    type: 'task_created',
    data: task
  });

  return task;
}

export async function moveAgentToHub(agentId, hubName) {
  const hub = await db.getHubByName(hubName);
  if (!hub) throw new Error(`Hub not found: ${hubName}`);

  const agent = state.agents.get(agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);

  // Calculate travel time based on distance (simplified)
  const distance = Math.sqrt(
    Math.pow(hub.position_x - agent.position_x, 2) +
    Math.pow(hub.position_z - agent.position_z, 2)
  );
  const travelTime = Math.max(2000, distance * 200); // min 2s, 200ms per unit

  await db.updateAgentStatus(agentId, 'traveling');
  agent.status = 'traveling';

  state.travelingAgents.set(agentId, {
    targetHubId: hub.id,
    arrivalTime: Date.now() + travelTime
  });

  await db.createMessage(agentId, 'status', `Traveling to ${hub.name}`);

  return { travelTime, hub };
}

export function getState() {
  return {
    agents: [...state.agents.values()],
    activeWork: [...state.activeWork.entries()],
    travelingAgents: [...state.travelingAgents.entries()]
  };
}
