/**
 * ElizaOS Orchestration Layer for Eliza Town
 *
 * This module replaces the old src/orchestration/loop.js with an
 * ElizaOS-powered version that uses the handleMessage paradigm.
 */

import * as runtimeManager from './runtimeManager.js';
import { updateAgentState, getAgentState } from './elizaTownPlugin.js';
import { HUBS, ROLE_HUBS, ELIZA_TOWN_CHARACTERS } from './characters.js';
import { setOrchestratorService, startDemoMode, stopDemoMode, DEMO_CONFIG } from './demoMode.js';
import type {
  BroadcastFn,
  ActiveWork,
  TravelingAgent,
  OrchestrationState,
  Task,
  Subtask,
  AgentRole,
  SavedFile,
} from '../types/index.js';

// Orchestration state
let isRunning = false;
let loopInterval: ReturnType<typeof setInterval> | null = null;
let dbModule: typeof import('../db/index.js') | null = null;
let broadcastFn: BroadcastFn | null = null;
let storageModule: typeof import('../storage/index.js') | null = null;

// Track active work and traveling agents
const activeWork = new Map<string, ActiveWork>();
const travelingAgents = new Map<string, TravelingAgent>();

// Configuration
const TICK_INTERVAL_MS = 5000;
const MAX_DECISIONS_PER_TICK = 2;
const AMBIENT_ACTIVITY_CHANCE = 0.15;

interface InitializeOptions {
  db?: typeof import('../db/index.js') | null;
  broadcast?: BroadcastFn | null;
  storage?: typeof import('../storage/index.js') | null;
}

/**
 * Initialize the orchestration system
 */
export async function initialize(options: InitializeOptions = {}): Promise<void> {
  dbModule = options.db || null;
  broadcastFn = options.broadcast || null;
  storageModule = options.storage || null;

  await runtimeManager.initialize({
    db: dbModule,
    broadcast: broadcastFn,
    storage: storageModule,
  });

  await runtimeManager.initializeAgents();

  if (dbModule) {
    const dbAgents = await dbModule.getAgents();
    for (const dbAgent of dbAgents) {
      const character = ELIZA_TOWN_CHARACTERS.find(
        (c) => c.name.toLowerCase() === dbAgent.name.toLowerCase() || c.role === dbAgent.type
      );

      if (character) {
        const initialHub = ROLE_HUBS[character.role] || 'town_square';
        updateAgentState(character.username, {
          dbId: dbAgent.id,
          name: dbAgent.name,
          role: dbAgent.type as AgentRole,
          status: dbAgent.status as 'idle' | 'working' | 'traveling' | 'chatting',
          hub: initialHub,
          x: HUBS[initialHub]?.x || 0,
          z: HUBS[initialHub]?.z || 0,
          modelId: dbAgent.model_id,
        });
      }
    }
  }

  // Wire up demo mode with orchestrator service adapter
  setOrchestratorService({
    createTask: async (name, description) => {
      if (!dbModule) return null;
      const task = await createTask(name, description, 5, null);
      return {
        id: String(task.id),
        name: task.title,
        description: task.description || undefined,
      };
    },
    startTaskExecution: async (_taskId) => {
      // Task execution is handled by the main tick loop
      return true;
    },
    getTask: async (taskId) => {
      if (!dbModule) return null;
      const task = await dbModule.getTask(parseInt(taskId, 10));
      if (!task) return null;
      return {
        id: String(task.id),
        name: task.title,
        description: task.description || undefined,
        metadata: { status: task.status },
      };
    },
    cancelTask: async (taskId) => {
      if (dbModule) {
        await dbModule.updateTaskStatus(parseInt(taskId, 10), 'cancelled');
      }
    },
  });

  console.log('[Orchestration] Initialized with ElizaOS agents');
}

/**
 * Start the orchestration loop
 */
export function start(intervalMs: number = TICK_INTERVAL_MS): void {
  if (isRunning) {
    console.log('[Orchestration] Already running');
    return;
  }

  isRunning = true;
  loopInterval = setInterval(tick, intervalMs);
  console.log(`[Orchestration] Started (${intervalMs}ms interval)`);

  // Auto-start demo mode if enabled
  if (DEMO_CONFIG.enabled && broadcastFn) {
    setTimeout(() => {
      console.log('[Orchestration] Starting demo mode...');
      startDemoMode(broadcastFn!).catch((err) => {
        console.error('[Orchestration] Failed to start demo mode:', err);
      });
    }, 5000); // Wait 5 seconds for system to stabilize
  }
}

/**
 * Stop the orchestration loop
 */
export function stop(): void {
  if (!isRunning) return;

  isRunning = false;
  if (loopInterval) {
    clearInterval(loopInterval);
    loopInterval = null;
  }

  // Stop demo mode if running
  stopDemoMode();

  console.log('[Orchestration] Stopped');
}

/**
 * Main orchestration tick
 */
async function tick(): Promise<void> {
  try {
    await updateTravelingAgents();

    const runtimes = runtimeManager.getAllRuntimes();
    const agentIds = Array.from(runtimes.keys());

    console.log(`[Orchestration] Tick: ${agentIds.length} agents`);

    let pendingTasks: Task[] = [];
    if (dbModule) {
      pendingTasks = await dbModule.getTasks('pending');
    }

    if (pendingTasks.length > 0) {
      const planners = agentIds.filter((id) => {
        const state = getAgentState(id);
        const metadata = runtimeManager.getMetadata(id);
        return metadata?.role === 'planner' && state.status === 'idle';
      });

      for (const task of pendingTasks) {
        if (planners.length === 0) break;
        const plannerId = planners.shift()!;
        await assignTaskToPlanner(plannerId, task);
      }
    }

    if (dbModule) {
      const inProgressTasks = await dbModule.getTasks('in_progress');
      for (const task of inProgressTasks) {
        await processTask(task);
      }
    }

    let decisionsTriggered = 0;
    const shuffledAgents = shuffleArray([...agentIds]);

    for (const agentId of shuffledAgents) {
      if (decisionsTriggered >= MAX_DECISIONS_PER_TICK) break;

      const state = getAgentState(agentId);

      if (state.status === 'traveling' || activeWork.has(agentId)) {
        continue;
      }

      const hasWork = await agentHasPendingWork(agentId);

      if (hasWork) {
        await runtimeManager.triggerWorkDecision(agentId);
        decisionsTriggered++;
      } else if (Math.random() < AMBIENT_ACTIVITY_CHANCE) {
        await runtimeManager.triggerChatDecision(agentId);
        decisionsTriggered++;
      }
    }

    await broadcastState();
  } catch (error) {
    console.error('[Orchestration] Tick error:', error);
  }
}

/**
 * Update traveling agents
 */
async function updateTravelingAgents(): Promise<void> {
  const now = Date.now();

  for (const [agentId, travel] of travelingAgents) {
    if (now >= travel.arrivalTime) {
      const state = getAgentState(agentId);
      const hub = HUBS[travel.targetHub];

      if (hub) {
        updateAgentState(agentId, {
          status: 'idle',
          hub: travel.targetHub,
          doing: undefined,
          x: hub.x,
          z: hub.z,
        });

        if (broadcastFn) {
          broadcastFn({
            type: 'agent_arrived',
            data: {
              agent: state.name,
              agentId,
              hub: travel.targetHub,
            },
          });
        }

        if (dbModule && state.dbId) {
          await dbModule.createMessage(state.dbId, 'status', `Arrived at ${hub.name}`);
        }
      }

      travelingAgents.delete(agentId);
    }
  }
}

/**
 * Assign a task to a planner agent
 */
async function assignTaskToPlanner(plannerId: string, task: Task): Promise<void> {
  const state = getAgentState(plannerId);
  const agentName = state.name || plannerId;

  console.log(`[Orchestration] Assigning task "${task.title}" to planner ${agentName}`);

  await moveAgentToHub(plannerId, 'planning_room');

  updateAgentState(plannerId, {
    status: 'working',
    doing: 'Analyzing task',
  });

  if (broadcastFn) {
    broadcastFn({
      type: 'agent_status',
      data: { agent: agentName, agentId: plannerId, status: 'working', doing: 'Analyzing task' },
    });

    broadcastFn({
      type: 'agent_speak',
      data: {
        agent: agentName,
        agentId: plannerId,
        text: `Let me break down: "${task.title}"`,
        type: 'saying',
      },
    });
  }

  if (dbModule && state.dbId) {
    await dbModule.updateTaskStatus(task.id, 'in_progress', state.dbId);
    await dbModule.createMessage(state.dbId, 'status', `Starting to analyze task: ${task.title}`, task.id);
  }

  const result = await runtimeManager.triggerAgentDecision(
    plannerId,
    `
You have been assigned a new task to analyze and break down:

Task: ${task.title}
Description: ${task.description || 'No description provided'}
Priority: ${task.priority}

As the lead planner, analyze this task and break it into specific subtasks.

IMPORTANT: You MUST output your subtasks in this exact JSON format:
\`\`\`json
{
  "subtasks": [
    {"title": "subtask title", "description": "what needs to be done", "type": "design|code|review"},
    ...
  ]
}
\`\`\`

Rules for subtasks:
- Create 2-5 subtasks based on task complexity
- Each subtask should be assignable to one agent type (designer, coder, or reviewer)
- Order them logically (design before code, code before review)
- Be specific about what each subtask should accomplish

After outputting the JSON, use SPEAK to announce your plan to the team.
`
  );

  if (result?.didRespond && dbModule) {
    interface SubtaskDef {
      title: string;
      description: string;
      order: number;
    }

    let subtasks: SubtaskDef[] = [];

    const responseText = result.text || '';
    const jsonMatch =
      responseText.match(/```json\s*([\s\S]*?)```/) || responseText.match(/\{[\s\S]*"subtasks"[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const parsed = JSON.parse(jsonStr);
        if (parsed.subtasks && Array.isArray(parsed.subtasks)) {
          subtasks = parsed.subtasks.map(
            (st: { title?: string; description?: string }, idx: number) => ({
              title: st.title || `Subtask ${idx + 1}`,
              description: st.description || '',
              order: idx + 1,
            })
          );
        }
      } catch (parseError) {
        console.warn(
          '[Orchestration] Could not parse planner JSON, using fallback:',
          (parseError as Error).message
        );
      }
    }

    if (subtasks.length === 0) {
      const bulletMatches = responseText.match(/[-•*]\s*(.+)/g) || responseText.match(/\d+[.)]\s*(.+)/g);
      if (bulletMatches && bulletMatches.length >= 2) {
        subtasks = bulletMatches.slice(0, 5).map((item, idx) => {
          const clean = item.replace(/^[-•*\d.)\s]+/, '').trim();
          const type = clean.toLowerCase().includes('design')
            ? 'design'
            : clean.toLowerCase().includes('review')
              ? 'review'
              : 'code';
          return {
            title: clean.substring(0, 100),
            description: `${type} phase`,
            order: idx + 1,
          };
        });
      }
    }

    if (subtasks.length === 0) {
      console.log('[Orchestration] Using default subtasks (LLM output not parseable)');
      const taskLower = task.title.toLowerCase();
      const isComplex =
        taskLower.includes('build') ||
        taskLower.includes('create') ||
        taskLower.includes('implement') ||
        (task.description?.length || 0) > 100;

      if (isComplex) {
        subtasks = [
          { title: `Design: ${task.title}`, description: 'Create architecture and design', order: 1 },
          { title: `Implement: ${task.title}`, description: 'Write the implementation', order: 2 },
          { title: `Review: ${task.title}`, description: 'Review and test', order: 3 },
        ];
      } else {
        subtasks = [
          { title: `Implement: ${task.title}`, description: 'Complete the implementation', order: 1 },
          { title: `Review: ${task.title}`, description: 'Verify correctness', order: 2 },
        ];
      }
    }

    for (const st of subtasks) {
      await dbModule.createSubtask(task.id, st.title, st.description, st.order);
    }

    console.log(`[Orchestration] Created ${subtasks.length} subtasks from planner analysis`);

    if (broadcastFn) {
      broadcastFn({
        type: 'agent_speak',
        data: {
          agent: agentName,
          agentId: plannerId,
          text: `I've broken this into ${subtasks.length} steps: ${subtasks.map((s) => s.title).join(', ')}`,
          type: 'saying',
        },
      });
    }
  }

  await moveAgentToHub(plannerId, 'town_square');
  updateAgentState(plannerId, {
    status: 'idle',
    doing: undefined,
  });

  if (broadcastFn) {
    broadcastFn({
      type: 'agent_status',
      data: { agent: agentName, agentId: plannerId, status: 'idle', doing: '' },
    });
  }
}

/**
 * Process an in-progress task
 */
async function processTask(task: Task): Promise<void> {
  if (!dbModule) return;

  const subtasks = await dbModule.getSubtasks(task.id);
  const pendingSubtask = subtasks.find((st) => st.status === 'pending');

  if (!pendingSubtask) {
    const allCompleted = subtasks.every((st) => st.status === 'completed');
    if (allCompleted && subtasks.length > 0) {
      await dbModule.updateTaskStatus(task.id, 'completed');

      if (broadcastFn) {
        broadcastFn({
          type: 'task_complete',
          data: {
            taskId: task.id,
            result: {
              downloadUrl: `/api/tasks/${task.id}/download`,
              previewUrl: `/api/tasks/${task.id}/preview`,
            },
          },
        });
      }
    }
    return;
  }

  const subtaskType = determineSubtaskType(pendingSubtask);
  const runtimes = runtimeManager.getAllRuntimes();

  let availableAgentId: string | null = null;
  for (const [agentId] of runtimes) {
    const state = getAgentState(agentId);
    const metadata = runtimeManager.getMetadata(agentId);

    if (metadata?.role === subtaskType && state.status === 'idle') {
      availableAgentId = agentId;
      break;
    }
  }

  if (!availableAgentId) return;

  await executeSubtask(availableAgentId, task, pendingSubtask);
}

/**
 * Determine what type of agent should handle a subtask
 */
function determineSubtaskType(subtask: Subtask): AgentRole {
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

/**
 * Extract and save code from LLM response
 */
async function extractAndSaveCode(
  taskId: number,
  responseText: string,
  _agentName: string
): Promise<SavedFile[]> {
  if (!storageModule || !responseText) return [];

  const savedFiles: SavedFile[] = [];

  try {
    const jsonMatch = responseText.match(/\{[\s\S]*"files"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.files && Array.isArray(parsed.files)) {
        const result = await storageModule.saveCoderOutput(taskId, parsed);
        savedFiles.push(...result);
        return savedFiles;
      }
    }
  } catch {
    // Not JSON, try other formats
  }

  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  let match;
  let fileIndex = 0;

  while ((match = codeBlockRegex.exec(responseText)) !== null) {
    const language = match[1] || 'txt';
    const code = match[2].trim();

    if (code.length > 20) {
      const extension = getExtensionForLanguage(language);
      const filename = `output_${fileIndex}.${extension}`;

      try {
        const filepath = await storageModule.saveTaskFile(taskId, filename, code);
        savedFiles.push({ name: filename, path: filepath, size: code.length });
        fileIndex++;
      } catch (e) {
        console.error(`[Orchestration] Failed to save ${filename}:`, e);
      }
    }
  }

  if (savedFiles.length === 0 && looksLikeCode(responseText)) {
    try {
      const filepath = await storageModule.saveTaskFile(taskId, 'output.txt', responseText);
      savedFiles.push({ name: 'output.txt', path: filepath, size: responseText.length });
    } catch (e) {
      console.error('[Orchestration] Failed to save output.txt:', e);
    }
  }

  return savedFiles;
}

/**
 * Get file extension for a language
 */
function getExtensionForLanguage(language: string): string {
  const extensionMap: Record<string, string> = {
    javascript: 'js',
    js: 'js',
    typescript: 'ts',
    ts: 'ts',
    python: 'py',
    py: 'py',
    java: 'java',
    rust: 'rs',
    go: 'go',
    html: 'html',
    css: 'css',
    json: 'json',
    sql: 'sql',
    shell: 'sh',
    bash: 'sh',
    sh: 'sh',
  };
  return extensionMap[language?.toLowerCase()] || 'txt';
}

/**
 * Check if text looks like code
 */
function looksLikeCode(text: string): boolean {
  const codeIndicators = [
    /function\s+\w+/,
    /const\s+\w+\s*=/,
    /let\s+\w+\s*=/,
    /var\s+\w+\s*=/,
    /import\s+.*from/,
    /export\s+(default|const|function|class)/,
    /class\s+\w+/,
    /def\s+\w+\(/,
    /if\s*\(.+\)\s*\{/,
    /=>\s*\{/,
  ];
  return codeIndicators.some((re) => re.test(text));
}

/**
 * Execute a subtask with an agent
 */
async function executeSubtask(agentId: string, task: Task, subtask: Subtask): Promise<void> {
  const state = getAgentState(agentId);
  const metadata = runtimeManager.getMetadata(agentId);
  const agentName = state.name || agentId;
  const workHub = ROLE_HUBS[metadata?.role as AgentRole] || 'town_square';

  console.log(`[Orchestration] Agent ${agentName} starting subtask: ${subtask.title}`);

  await moveAgentToHub(agentId, workHub);

  updateAgentState(agentId, {
    status: 'working',
    doing: subtask.title,
  });

  if (dbModule && state.dbId) {
    await dbModule.updateAgentStatus(state.dbId, 'working');
    await dbModule.updateSubtaskStatus(subtask.id, 'in_progress');
    await dbModule.createMessage(state.dbId, 'status', `Working on: ${subtask.title}`, task.id, subtask.id);
  }

  if (broadcastFn) {
    broadcastFn({
      type: 'agent_status',
      data: { agent: agentName, agentId, status: 'working', doing: subtask.title },
    });

    broadcastFn({
      type: 'agent_speak',
      data: { agent: agentName, agentId, text: `Working on: ${subtask.title}`, type: 'saying' },
    });
  }

  activeWork.set(agentId, {
    taskId: task.id,
    subtaskId: subtask.id,
    startedAt: Date.now(),
  });

  let rolePrompt = '';

  if (metadata?.role === 'coder') {
    rolePrompt = `
You are implementing code for a task. All agents share ONE codebase.

Main Task: ${task.title}
Subtask: ${subtask.title}
Description: ${subtask.description || 'No description provided'}

WORKFLOW:
1. First, use LIST_FILES to see what exists in the codebase
2. Use READ_FILE to examine relevant existing code
3. Use WRITE_FILE to create new files OR EDIT_FILE to modify existing ones
4. Use EXECUTE_SHELL to run tests: npm test, tsc --noEmit
5. Use SPEAK to announce when done

Example:
- LIST_FILES with path="." to see the codebase
- WRITE_FILE with filepath="src/solution.ts" and content="your code here"
- EXECUTE_SHELL with command="tsc --noEmit" to type-check

Write complete, working code. Other agents will see your files.`;
  } else if (metadata?.role === 'designer') {
    rolePrompt = `
You are creating design specifications. All agents share ONE codebase.

Main Task: ${task.title}
Subtask: ${subtask.title}
Description: ${subtask.description || 'No description provided'}

WORKFLOW:
1. Use LIST_FILES to understand the current codebase structure
2. Use READ_FILE to examine existing code/designs
3. Use WRITE_FILE to create design docs (e.g., docs/design.md)
4. Use SPEAK to explain your design to the team

Create design specs in markdown that coders Ada and Byron can implement.
Include: architecture, data models, API contracts, component interfaces.`;
  } else if (metadata?.role === 'reviewer') {
    rolePrompt = `
You are reviewing code for quality. All agents share ONE codebase.

Main Task: ${task.title}
Subtask: ${subtask.title}
Description: ${subtask.description || 'No description provided'}

WORKFLOW:
1. Check CODEBASE provider to see recent file changes
2. Use READ_FILE to examine the code that was changed
3. Use EXECUTE_SHELL to run tests: npm test
4. Use EXECUTE_SHELL to run linting: npm run lint
5. Use WRITE_FILE to create a review: docs/review.md
6. Use SPEAK to announce your findings

Provide constructive feedback. If you find small issues, you can use EDIT_FILE to fix them directly.`;
  } else {
    rolePrompt = `
You are working on a subtask. All agents share ONE codebase.

Main Task: ${task.title}
Subtask: ${subtask.title}
Description: ${subtask.description || 'No description provided'}

Use READ_FILE, WRITE_FILE, EDIT_FILE to work with the codebase.
Use SPEAK to communicate progress.`;
  }

  const result = await runtimeManager.triggerAgentDecision(agentId, rolePrompt);

  if (metadata?.role === 'coder' && result?.text && storageModule) {
    const savedFiles = await extractAndSaveCode(task.id, result.text, agentName);
    if (savedFiles.length > 0) {
      console.log(`[Orchestration] ${agentName} saved ${savedFiles.length} file(s)`);
      if (broadcastFn) {
        for (const file of savedFiles) {
          broadcastFn({
            type: 'file_created',
            data: { taskId: task.id, filename: file.name, size: file.size, agent: agentName },
          });
        }
      }
    }
  }

  if (dbModule) {
    await dbModule.updateSubtaskStatus(subtask.id, 'completed', result?.text || 'Completed');
    if (state.dbId) {
      await dbModule.createMessage(
        state.dbId,
        'thought',
        `Completed: ${subtask.title}`,
        task.id,
        subtask.id
      );
    }
  }

  if (broadcastFn) {
    broadcastFn({
      type: 'agent_speak',
      data: { agent: agentName, agentId, text: `Done with ${subtask.title}!`, type: 'saying' },
    });
  }

  activeWork.delete(agentId);

  await moveAgentToHub(agentId, 'town_square');

  updateAgentState(agentId, {
    status: 'idle',
    doing: undefined,
  });

  if (dbModule && state.dbId) {
    await dbModule.updateAgentStatus(state.dbId, 'idle');
  }

  if (broadcastFn) {
    broadcastFn({
      type: 'agent_status',
      data: { agent: agentName, agentId, status: 'idle', doing: '' },
    });
  }
}

/**
 * Move an agent to a hub
 */
async function moveAgentToHub(agentId: string, targetHub: string): Promise<void> {
  const state = getAgentState(agentId);
  const currentHub = state.hub || 'town_square';
  const hub = HUBS[targetHub];

  if (!hub || currentHub === targetHub) return;

  const currentPos = HUBS[currentHub] || { x: 0, z: 0 };
  const distance = Math.sqrt(
    Math.pow(hub.x - currentPos.x, 2) + Math.pow(hub.z - currentPos.z, 2)
  );
  const travelTime = Math.max(1500, distance * 100);

  if (broadcastFn) {
    broadcastFn({
      type: 'agent_move',
      data: {
        agent: state.name,
        agentId,
        from: currentPos,
        to: { x: hub.x, z: hub.z },
        hub: targetHub,
      },
    });
  }

  travelingAgents.set(agentId, {
    targetHub,
    arrivalTime: Date.now() + travelTime,
  });

  await new Promise((resolve) => setTimeout(resolve, travelTime + 200));

  updateAgentState(agentId, {
    hub: targetHub,
    x: hub.x,
    z: hub.z,
  });
}

/**
 * Check if an agent has pending work
 */
async function agentHasPendingWork(agentId: string): Promise<boolean> {
  if (!dbModule) return false;

  const state = getAgentState(agentId);
  const metadata = runtimeManager.getMetadata(agentId);

  if (!state.dbId) return false;

  const inProgressTasks = await dbModule.getTasks('in_progress');
  const assignedTasks = inProgressTasks.filter((t) => t.assigned_agent_id === state.dbId);

  if (assignedTasks.length > 0) return true;

  const pendingTasks = await dbModule.getTasks('pending');
  if (pendingTasks.length > 0 && metadata?.role === 'planner') {
    return true;
  }

  return false;
}

/**
 * Broadcast current state to all clients
 */
async function broadcastState(): Promise<void> {
  if (!broadcastFn) return;

  const runtimes = runtimeManager.getAllRuntimes();
  const agents: Array<{
    id: number | string;
    name: string | undefined;
    type: AgentRole | undefined;
    status: string;
    model_id: string | undefined;
    position_x: number;
    position_z: number;
    current_hub: string;
  }> = [];

  for (const [agentId] of runtimes) {
    const state = getAgentState(agentId);
    const metadata = runtimeManager.getMetadata(agentId);

    agents.push({
      id: state.dbId || agentId,
      name: state.name,
      type: metadata?.role,
      status: state.status,
      model_id: metadata?.modelId,
      position_x: state.x,
      position_z: state.z,
      current_hub: state.hub,
    });
  }

  let tasks: Task[] = [];
  let messages: Array<{ id: number; content: string; agent_name?: string; type: string; created_at: Date }> = [];

  if (dbModule) {
    tasks = await dbModule.getTasks();
    messages = await dbModule.getRecentMessages(20);
  }

  broadcastFn({
    type: 'state_update',
    data: {
      agents,
      tasks,
      messages,
      timestamp: Date.now(),
    },
  });
}

/**
 * Create a new task
 */
export async function createTask(
  title: string,
  description: string | null,
  priority: number = 5,
  sessionId: string | null = null
): Promise<Task> {
  if (!dbModule) {
    throw new Error('Database not available');
  }

  const task = await dbModule.createTask(title, description, priority, sessionId);

  if (broadcastFn) {
    broadcastFn({
      type: 'task_created',
      data: task as unknown as Record<string, unknown>,
    });
  }

  return task;
}

/**
 * Get current orchestration state
 */
export function getState() {
  const runtimes = runtimeManager.getAllRuntimes();
  const agents: Array<{
    agentId: string;
    dbId: number | null;
    name: string;
    role: string;
    modelId: string;
    status: string;
    hub: string;
    x: number;
    z: number;
  }> = [];

  for (const [agentId] of runtimes) {
    const state = getAgentState(agentId);
    const metadata = runtimeManager.getMetadata(agentId);
    agents.push({
      agentId,
      dbId: metadata?.dbId || null,
      name: metadata?.name || state.name || agentId,
      role: metadata?.role || state.role || 'coder',
      modelId: metadata?.modelId || '',
      status: state.status,
      hub: state.hub,
      x: state.x,
      z: state.z,
    });
  }

  return {
    isRunning,
    agents,
    activeWork: [...activeWork.entries()],
    travelingAgents: [...travelingAgents.entries()],
  };
}

/**
 * Shuffle array utility
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
