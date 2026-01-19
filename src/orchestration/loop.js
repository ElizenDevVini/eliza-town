import * as db from '../db/index.js';
import * as claude from '../agents/claude.js';
import { AGENT_TYPES, getAgentConfig } from '../agents/config.js';
import { broadcast } from '../websocket/index.js';

let isRunning = false;
let loopInterval = null;

// Orchestration state
const state = {
  agents: new Map(),
  activeWork: new Map(), // agentId -> { taskId, subtaskId, startedAt }
  travelingAgents: new Map() // agentId -> { targetHubId, arrivalTime }
};

export async function initialize() {
  // Load agents into state
  const agents = await db.getAgents();
  for (const agent of agents) {
    state.agents.set(agent.id, agent);
  }
  console.log(`Orchestration initialized with ${agents.length} agents`);
}

export function start(intervalMs = 5000) {
  if (isRunning) return;
  isRunning = true;
  loopInterval = setInterval(tick, intervalMs);
  console.log('Orchestration loop started');
}

export function stop() {
  if (!isRunning) return;
  isRunning = false;
  clearInterval(loopInterval);
  console.log('Orchestration loop stopped');
}

async function tick() {
  try {
    // Update traveling agents
    await updateTravelingAgents();

    // Check for pending tasks
    const pendingTasks = await db.getTasks('pending');

    // Find idle planner agents
    const planners = [...state.agents.values()].filter(
      a => a.type === 'planner' && a.status === 'idle'
    );

    // Assign pending tasks to planners for breakdown
    for (const task of pendingTasks) {
      if (planners.length === 0) break;
      const planner = planners.shift();
      await assignTaskToPlanner(planner, task);
    }

    // Process in-progress tasks
    const inProgressTasks = await db.getTasks('in_progress');
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

  // Update planner status
  await db.updateAgentStatus(planner.id, 'working');
  state.agents.get(planner.id).status = 'working';

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

      // Create subtasks
      if (analysis.subtasks && Array.isArray(analysis.subtasks)) {
        for (let i = 0; i < analysis.subtasks.length; i++) {
          const st = analysis.subtasks[i];
          await db.createSubtask(task.id, st.title, st.description, st.order || i);
        }
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

  // Return planner to idle
  await db.updateAgentStatus(planner.id, 'idle');
  state.agents.get(planner.id).status = 'idle';
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

  // Update statuses
  await db.updateAgentStatus(agent.id, 'working');
  state.agents.get(agent.id).status = 'working';
  await db.updateSubtaskStatus(subtask.id, 'in_progress');

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
      result = await claude.designSolution(agent.id, task, subtask);
      break;
    case 'coder':
      result = await claude.implementCode(agent.id, task, subtask);
      break;
    case 'reviewer':
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
  } else {
    await db.createMessage(
      agent.id,
      'thought',
      `Encountered an issue with: ${subtask.title}`,
      task.id,
      subtask.id
    );
  }

  // Return agent to idle
  await db.updateAgentStatus(agent.id, 'idle');
  state.agents.get(agent.id).status = 'idle';
}

async function updateTravelingAgents() {
  const now = Date.now();

  for (const [agentId, travel] of state.travelingAgents) {
    if (now >= travel.arrivalTime) {
      // Agent arrived at destination
      const hub = await db.getHub(travel.targetHubId);
      await db.updateAgentStatus(agentId, 'idle', travel.targetHubId, hub.position_x, hub.position_z);

      const agent = state.agents.get(agentId);
      agent.status = 'idle';
      agent.current_hub_id = travel.targetHubId;
      agent.position_x = hub.position_x;
      agent.position_z = hub.position_z;

      await db.createMessage(agentId, 'status', `Arrived at ${hub.name}`);

      state.travelingAgents.delete(agentId);
    }
  }
}

async function generateAmbientActivity() {
  // Randomly generate thoughts or chats for idle agents
  const idleAgents = [...state.agents.values()].filter(a => a.status === 'idle');

  if (idleAgents.length === 0) return;

  // 10% chance per tick for ambient activity
  if (Math.random() > 0.1) return;

  const agent = idleAgents[Math.floor(Math.random() * idleAgents.length)];

  // 70% thoughts, 30% chats
  if (Math.random() < 0.7) {
    const thought = await claude.generateThought(
      agent.id,
      agent.type,
      `Agent ${agent.name} is idle in ${agent.current_hub_id ? 'a hub' : 'the town'}`
    );
    if (thought) {
      await db.createMessage(agent.id, 'thought', thought);
    }
  } else if (idleAgents.length > 1) {
    const otherAgents = idleAgents.filter(a => a.id !== agent.id);
    const target = otherAgents[Math.floor(Math.random() * otherAgents.length)];
    const chat = await claude.generateChat(agent.id, agent.type, target.name, 'work and projects');
    if (chat) {
      await db.createMessage(agent.id, 'chat', chat, null, null, target.id);
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
export async function createTask(title, description, priority = 5) {
  const task = await db.createTask(title, description, priority);

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
