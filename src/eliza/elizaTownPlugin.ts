/**
 * ElizaOS Plugin for Eliza Town
 *
 * This plugin provides custom actions and providers for the Eliza Town game.
 * It integrates with the existing database and WebSocket infrastructure.
 */

import { HUBS, getHubForRole, type AgentRole, type HubName, type HubInfo } from './characters.js';
import type { WebSocketMessage } from '../websocket/index.js';
import type * as DbModule from '../db/index.js';
import type * as StorageModule from '../storage/index.js';
import { getSharedSandbox } from './sharedSandbox.js';

// Type definitions
export interface AgentState {
  dbId?: number;
  name?: string;
  role?: AgentRole;
  status: string;
  hub: HubName | string;
  x: number;
  z: number;
  doing?: string | null;
  targetHub?: string;
  travelStarted?: number;
  travelTime?: number;
  updatedAt?: number;
  modelId?: string;
}

export interface ProviderResult {
  text: string;
  values: Record<string, unknown>;
  data: Record<string, unknown>;
}

export interface ActionResult {
  success: boolean;
  text: string;
  data?: Record<string, unknown>;
}

export interface ActionOptions {
  parameters?: Record<string, string | number | null>;
}

interface ElizaRuntime {
  character?: {
    username?: string;
    name?: string;
    role?: AgentRole;
  };
  agentId?: string;
}

type BroadcastFn = (message: WebSocketMessage) => void;

// Callback type for broadcasting to other agents' ElizaOS memories
type MemoryBroadcastFn = (
  authorId: string,
  text: string,
  messageType: 'speech' | 'thought' | 'action'
) => Promise<void>;

// Store references to external services (set by orchestration layer)
let dbModule: typeof DbModule | null = null;
let broadcastFn: BroadcastFn | null = null;
let storageModule: typeof StorageModule | null = null;
let memoryBroadcastFn: MemoryBroadcastFn | null = null;
const agentStates = new Map<string, AgentState>(); // Track agent positions and states locally

/**
 * Initialize the plugin with external dependencies
 */
export function initializePlugin(
  db: typeof DbModule | null,
  broadcast: BroadcastFn | null,
  storage: typeof StorageModule | null = null
): void {
  dbModule = db;
  broadcastFn = broadcast;
  storageModule = storage;
}

/**
 * Set the memory broadcast function (called from runtimeManager after initialization)
 * This enables agent-to-agent communication through ElizaOS memories
 */
export function setMemoryBroadcastFn(fn: MemoryBroadcastFn): void {
  memoryBroadcastFn = fn;
  console.log('[eliza-town] Memory broadcast function set - agent-to-agent communication enabled');
}

/**
 * Update agent state locally (called by orchestration)
 */
export function updateAgentState(agentId: string, state: Partial<AgentState>): void {
  agentStates.set(agentId, { ...agentStates.get(agentId), ...state, updatedAt: Date.now() } as AgentState);
}

/**
 * Get agent state
 */
export function getAgentState(agentId: string): AgentState {
  return agentStates.get(agentId) || { status: 'idle', hub: 'town_square', x: 0, z: 0 };
}

// ============================================================================
// PROVIDERS - What agents can see/know
// ============================================================================

/**
 * TOWN_STATE Provider - Shows current state of the town
 */
const townStateProvider = {
  name: 'TOWN_STATE',
  description: 'Current state of Eliza Town including agents, hubs, and activity',
  get: async (runtime: ElizaRuntime): Promise<ProviderResult> => {
    const agentId = runtime.character?.username || runtime.agentId || 'unknown';
    const currentState = getAgentState(agentId);

    // Get all agent states
    interface AgentInfo {
      id: string;
      name: string;
      status: string;
      hub: string;
      doing: string | null;
    }

    const allAgents: AgentInfo[] = [];
    for (const [id, agentState] of agentStates) {
      allAgents.push({
        id,
        name: agentState.name || id,
        status: agentState.status || 'idle',
        hub: agentState.hub || 'town_square',
        doing: agentState.doing || null
      });
    }

    // Build hub occupancy
    interface HubOccupancy extends HubInfo {
      agents: string[];
    }

    const hubOccupancy: Record<string, HubOccupancy> = {};
    for (const [hubName, hubInfo] of Object.entries(HUBS)) {
      hubOccupancy[hubName] = {
        ...hubInfo,
        agents: allAgents.filter(a => a.hub === hubName).map(a => a.name)
      };
    }

    // Format text output
    const lines: string[] = [
      `[TOWN_STATE]`,
      `Your location: ${HUBS[currentState.hub as HubName]?.name || currentState.hub} (${currentState.hub})`,
      `Your status: ${currentState.status}`,
      ``,
      `Agents in town:`,
    ];

    for (const agent of allAgents) {
      const statusText = agent.doing ? `${agent.status} - ${agent.doing}` : agent.status;
      lines.push(`  - ${agent.name}: ${statusText} @ ${HUBS[agent.hub as HubName]?.name || agent.hub}`);
    }

    lines.push(``);
    lines.push(`Available hubs:`);
    for (const [hubName, hub] of Object.entries(hubOccupancy)) {
      const occupants = hub.agents.length > 0 ? hub.agents.join(', ') : 'empty';
      lines.push(`  - ${hub.name}: ${occupants}`);
    }
    lines.push(`[/TOWN_STATE]`);

    return {
      text: lines.join('\n'),
      values: {
        currentHub: currentState.hub,
        currentStatus: currentState.status,
        agentCount: allAgents.length
      },
      data: {
        currentAgent: { id: agentId, ...currentState },
        agents: allAgents,
        hubs: hubOccupancy
      }
    };
  }
};

/**
 * TASKS Provider - Shows assigned tasks for the agent
 */
const tasksProvider = {
  name: 'TASKS',
  description: 'Tasks and subtasks assigned to this agent',
  get: async (runtime: ElizaRuntime): Promise<ProviderResult> => {
    const agentId = runtime.character?.username || runtime.agentId || 'unknown';

    let tasks: DbModule.Task[] = [];
    let subtasks: DbModule.Subtask[] = [];

    if (dbModule) {
      try {
        // Get all tasks - we'll filter on the server
        const allTasks = await dbModule.getTasks('in_progress');
        tasks = allTasks.filter(t => {
          // Find tasks assigned to this agent
          const agentState = getAgentState(agentId);
          return t.assigned_agent_id === agentState.dbId;
        });

        // Get subtasks for these tasks
        for (const task of tasks) {
          const taskSubtasks = await dbModule.getSubtasks(task.id);
          subtasks.push(...taskSubtasks.filter(st => st.status === 'pending' || st.status === 'in_progress'));
        }

        // Also get pending tasks that might need assignment
        const pendingTasks = await dbModule.getTasks('pending');
        tasks = [...tasks, ...pendingTasks.slice(0, 3)]; // Show up to 3 pending
      } catch (error) {
        console.error('Error fetching tasks:', error);
      }
    }

    const lines: string[] = [
      `[TASKS]`,
      `Assigned tasks: ${tasks.length}`,
      ``
    ];

    if (tasks.length === 0) {
      lines.push(`No tasks currently assigned. You are free to help others or wait.`);
    } else {
      for (const task of tasks) {
        lines.push(`Task: ${task.title} (${task.status})`);
        lines.push(`  Priority: ${task.priority}`);
        lines.push(`  Description: ${task.description || 'No description'}`);

        const taskSubtasks = subtasks.filter(st => st.task_id === task.id);
        if (taskSubtasks.length > 0) {
          lines.push(`  Subtasks:`);
          for (const st of taskSubtasks) {
            lines.push(`    - ${st.title} (${st.status})`);
          }
        }
        lines.push(``);
      }
    }

    lines.push(`[/TASKS]`);

    return {
      text: lines.join('\n'),
      values: {
        taskCount: tasks.length,
        pendingSubtasks: subtasks.filter(st => st.status === 'pending').length
      },
      data: { tasks, subtasks }
    };
  }
};

/**
 * NEARBY_AGENTS Provider - Shows agents in the same hub
 */
const nearbyAgentsProvider = {
  name: 'NEARBY_AGENTS',
  description: 'Agents that are nearby (in the same hub)',
  get: async (runtime: ElizaRuntime): Promise<ProviderResult> => {
    const agentId = runtime.character?.username || runtime.agentId || 'unknown';
    const currentState = getAgentState(agentId);
    const currentHub = currentState.hub || 'town_square';

    // Find agents in the same hub
    interface NearbyAgent {
      id: string;
      name: string;
      status: string;
      doing: string | null | undefined;
    }

    const nearbyAgents: NearbyAgent[] = [];
    for (const [id, agentState] of agentStates) {
      if (id !== agentId && agentState.hub === currentHub) {
        nearbyAgents.push({
          id,
          name: agentState.name || id,
          status: agentState.status || 'idle',
          doing: agentState.doing
        });
      }
    }

    const lines: string[] = [
      `[NEARBY_AGENTS]`,
      `Your location: ${HUBS[currentHub as HubName]?.name || currentHub}`,
      ``
    ];

    if (nearbyAgents.length === 0) {
      lines.push(`You are alone in this area.`);
    } else {
      lines.push(`Agents nearby (${nearbyAgents.length}):`);
      for (const agent of nearbyAgents) {
        const statusText = agent.doing ? `${agent.status} - ${agent.doing}` : agent.status;
        lines.push(`  - ${agent.name}: ${statusText}`);
      }
    }

    lines.push(`[/NEARBY_AGENTS]`);

    return {
      text: lines.join('\n'),
      values: {
        nearbyCount: nearbyAgents.length,
        currentHub
      },
      data: { nearbyAgents, currentHub }
    };
  }
};

/**
 * RECENT_MESSAGES Provider - Shows recent messages from other agents
 * This provider reads from the agent's own ElizaOS memory (populated by broadcasts)
 */
const recentMessagesProvider = {
  name: 'RECENT_MESSAGES',
  description: 'Recent messages spoken by other agents that you heard',
  get: async (runtime: ElizaRuntime): Promise<ProviderResult> => {
    const agentId = runtime.character?.username || runtime.agentId || 'unknown';
    const agentName = runtime.character?.name || agentId;

    // Try to get recent memories from the runtime if available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runtimeAny = runtime as any;
    let recentMessages: Array<{ author: string; text: string; time: number }> = [];

    if (runtimeAny.getMemories) {
      try {
        const memories = await runtimeAny.getMemories({
          count: 10,
          tableName: 'messages',
        });

        recentMessages = memories
          .filter((m: { content?: { metadata?: { authorName?: string } } }) => 
            m.content?.metadata?.authorName && m.content.metadata.authorName !== agentName
          )
          .map((m: { content: { text?: string; metadata?: { authorName?: string; timestamp?: number } }; createdAt?: number }) => ({
            author: m.content.metadata?.authorName || 'Unknown',
            text: m.content.text || '',
            time: m.content.metadata?.timestamp || m.createdAt || Date.now(),
          }))
          .slice(0, 10);
      } catch (error) {
        console.error('[RECENT_MESSAGES] Error fetching memories:', error);
      }
    }

    const lines: string[] = [
      `[RECENT_MESSAGES]`,
      `Messages you've heard recently:`,
      ``
    ];

    if (recentMessages.length === 0) {
      lines.push(`(No recent messages from other agents)`);
    } else {
      for (const msg of recentMessages) {
        const timeAgo = Math.round((Date.now() - msg.time) / 1000);
        const timeStr = timeAgo < 60 ? `${timeAgo}s ago` : `${Math.round(timeAgo / 60)}m ago`;
        lines.push(`  ${msg.author} (${timeStr}): "${msg.text}"`);
      }
    }

    lines.push(`[/RECENT_MESSAGES]`);

    return {
      text: lines.join('\n'),
      values: {
        messageCount: recentMessages.length,
      },
      data: { recentMessages }
    };
  }
};

/**
 * CODEBASE Provider - Shows the state of the shared codebase/sandbox
 * All agents share ONE sandbox, so they can see each other's file changes
 */
const codebaseProvider = {
  name: 'CODEBASE',
  description: 'The shared codebase that all agents work on together',
  get: async (runtime: ElizaRuntime): Promise<ProviderResult> => {
    const agentName = runtime.character?.name || runtime.agentId || 'unknown';
    
    const lines: string[] = [
      `[CODEBASE]`,
      `Shared workspace for all agents in Eliza Town`,
      ``
    ];

    try {
      const sandbox = getSharedSandbox();
      const config = sandbox.getConfig();
      const recentChanges = sandbox.getRecentChanges(10);
      const cwd = sandbox.getCurrentDirectory();

      lines.push(`Mode: ${config.mode === 'e2b' ? 'E2B Cloud Sandbox' : 'Local Filesystem'}`);
      lines.push(`Working Directory: ${cwd}`);
      lines.push(``);

      // Show recent file changes by other agents
      if (recentChanges.length > 0) {
        lines.push(`Recent file changes:`);
        for (const change of recentChanges) {
          const timeAgo = Math.round((Date.now() - change.timestamp) / 1000);
          const timeStr = timeAgo < 60 ? `${timeAgo}s ago` : `${Math.round(timeAgo / 60)}m ago`;
          const changeIcon = change.type === 'created' ? '+' : change.type === 'modified' ? '~' : '-';
          lines.push(`  ${changeIcon} ${change.filepath} (${change.agent}, ${timeStr})`);
        }
      } else {
        lines.push(`No recent file changes.`);
      }

      lines.push(``);

      // Try to list files in current directory
      const listResult = await sandbox.listFiles('.', agentName);
      if (listResult.ok && listResult.items) {
        const dirs = listResult.items.filter(f => f.isDirectory);
        const files = listResult.items.filter(f => !f.isDirectory);

        lines.push(`Current directory contents:`);
        if (dirs.length > 0) {
          lines.push(`  Directories: ${dirs.map(d => d.name + '/').join(', ')}`);
        }
        if (files.length > 0) {
          const fileList = files.slice(0, 10).map(f => f.name).join(', ');
          const moreFiles = files.length > 10 ? ` (+${files.length - 10} more)` : '';
          lines.push(`  Files: ${fileList}${moreFiles}`);
        }
        if (dirs.length === 0 && files.length === 0) {
          lines.push(`  (empty directory)`);
        }
      }

      lines.push(``);
      lines.push(`Use READ_FILE, WRITE_FILE, EDIT_FILE to work on the codebase.`);
      lines.push(`Use LIST_FILES, SEARCH_FILES to explore.`);
      lines.push(`Use EXECUTE_SHELL to run commands (npm, git, etc).`);

    } catch (error) {
      lines.push(`Sandbox not available: ${(error as Error).message}`);
      lines.push(`Set CODER_ENABLED=true to enable code operations.`);
    }

    lines.push(`[/CODEBASE]`);

    return {
      text: lines.join('\n'),
      values: {
        sandboxEnabled: process.env.CODER_ENABLED === 'true',
      },
      data: {}
    };
  }
};

// ============================================================================
// ACTIONS - What agents can do
// ============================================================================

/**
 * MOVE Action - Move to a hub or toward another agent
 */
const moveAction = {
  name: 'MOVE',
  description: 'Move to a target location in Eliza Town. Can target a hub name or another agent.',
  parameters: [
    {
      name: 'target',
      description: 'Hub name (town_square, planning_room, design_studio, coding_desk, review_station, deploy_station) or agent name',
      required: true,
      schema: { type: 'string' },
      examples: ['planning_room', 'town_square', 'Eliza', 'Ada']
    }
  ],
  validate: async (): Promise<boolean> => {
    return true; // Always available
  },
  handler: async (runtime: ElizaRuntime, _message: unknown, _state: unknown, options?: ActionOptions): Promise<ActionResult> => {
    const agentId = runtime.character?.username || runtime.agentId || 'unknown';
    const agentName = runtime.character?.name || agentId;
    const params = options?.parameters || {};
    const target = params.target as string | undefined;

    if (!target) {
      return { success: false, text: 'No target specified for MOVE action.' };
    }

    const targetLower = target.toLowerCase().replace(/\s+/g, '_');
    let targetHub: string | null = null;
    let targetInfo: (HubInfo & { targetAgent?: string }) | null = null;

    // Check if target is a hub
    if (HUBS[targetLower as HubName]) {
      targetHub = targetLower;
      targetInfo = HUBS[targetLower as HubName];
    } else {
      // Check if target is an agent name - find their hub
      for (const [id, agentState] of agentStates) {
        if (agentState.name?.toLowerCase() === target.toLowerCase() ||
            id.toLowerCase() === target.toLowerCase()) {
          targetHub = agentState.hub || 'town_square';
          targetInfo = { ...HUBS[targetHub as HubName], targetAgent: agentState.name || id };
          break;
        }
      }
    }

    if (!targetHub) {
      return {
        success: false,
        text: `Unknown target: "${target}". Use a hub name (town_square, planning_room, etc.) or agent name.`
      };
    }

    // Get current state
    const currentState = getAgentState(agentId);
    const currentHub = currentState.hub || 'town_square';

    if (currentHub === targetHub) {
      return {
        success: true,
        text: `You are already at ${HUBS[targetHub as HubName]?.name || targetHub}.`
      };
    }

    // Calculate travel time (simplified)
    const currentPos = HUBS[currentHub as HubName] || { x: 0, z: 0 };
    const targetPos = HUBS[targetHub as HubName] || { x: 0, z: 0 };
    const distance = Math.sqrt(
      Math.pow(targetPos.x - currentPos.x, 2) +
      Math.pow(targetPos.z - currentPos.z, 2)
    );
    const travelTime = Math.max(1500, distance * 100);

    // Update agent state to traveling
    updateAgentState(agentId, {
      status: 'traveling',
      doing: `Moving to ${HUBS[targetHub as HubName]?.name || targetHub}`,
      targetHub,
      travelStarted: Date.now(),
      travelTime
    });

    // Broadcast move event
    if (broadcastFn) {
      broadcastFn({
        type: 'agent_move',
        data: {
          agent: agentName,
          agentId,
          from: currentPos,
          to: targetPos,
          hub: targetHub
        }
      });
    }

    // Schedule arrival (in a real system this would be async)
    setTimeout(() => {
      updateAgentState(agentId, {
        status: 'idle',
        hub: targetHub as HubName,
        doing: null,
        x: targetPos.x,
        z: targetPos.z
      });

      if (broadcastFn) {
        broadcastFn({
          type: 'agent_arrived',
          data: { agent: agentName, agentId, hub: targetHub }
        });
      }
    }, travelTime);

    const moveText = targetInfo?.targetAgent
      ? `Moving toward ${targetInfo.targetAgent} at ${HUBS[targetHub as HubName]?.name || targetHub}.`
      : `Moving to ${HUBS[targetHub as HubName]?.name || targetHub}.`;

    return {
      success: true,
      text: moveText,
      data: { targetHub, travelTime }
    };
  }
};

/**
 * SPEAK Action - Say something out loud (broadcast to nearby agents)
 */
const speakAction = {
  name: 'SPEAK',
  description: 'Say something out loud that nearby agents can hear.',
  parameters: [
    {
      name: 'message',
      description: 'What to say',
      required: true,
      schema: { type: 'string' },
      examples: ['Hello everyone!', 'I finished the design review.']
    },
    {
      name: 'target',
      description: 'Optionally direct the message to a specific agent',
      required: false,
      schema: { type: 'string' }
    }
  ],
  validate: async (): Promise<boolean> => true,
  handler: async (runtime: ElizaRuntime, _message: unknown, _state: unknown, options?: ActionOptions): Promise<ActionResult> => {
    const agentId = runtime.character?.username || runtime.agentId || 'unknown';
    const agentName = runtime.character?.name || agentId;
    const params = options?.parameters || {};
    const text = (params.message || params.text) as string | undefined;
    const target = params.target as string | undefined;

    if (!text) {
      return { success: false, text: 'No message specified for SPEAK action.' };
    }

    // Get current state for context
    const currentState = getAgentState(agentId);

    // Store message in database
    if (dbModule && currentState.dbId) {
      try {
        await dbModule.createMessage(
          currentState.dbId,
          target ? 'chat' : 'saying',
          text,
          null,
          null,
          null,
          null
        );
      } catch (error) {
        console.error('Error storing message:', error);
      }
    }

    // Broadcast speech event via WebSocket (for frontend)
    if (broadcastFn) {
      broadcastFn({
        type: 'agent_speak',
        data: {
          agent: agentName,
          agentId,
          text,
          type: target ? 'chat' : 'saying',
          toAgent: target || null
        }
      });
    }

    // CRITICAL: Broadcast to all other agents' ElizaOS memories
    // This is what makes agents actually "hear" each other
    if (memoryBroadcastFn) {
      memoryBroadcastFn(agentId, text, 'speech').catch((err) => {
        console.error('[SPEAK] Failed to broadcast to agent memories:', err);
      });
    }

    const speakText = target
      ? `Said to ${target}: "${text}"`
      : `Said: "${text}"`;

    return {
      success: true,
      text: speakText,
      data: { spoken: text, target }
    };
  }
};

/**
 * THINK Action - Internal thought (shown as thought bubble)
 */
const thinkAction = {
  name: 'THINK',
  description: 'Think something internally (shows as thought bubble).',
  parameters: [
    {
      name: 'thought',
      description: 'What to think',
      required: true,
      schema: { type: 'string' }
    }
  ],
  validate: async (): Promise<boolean> => true,
  handler: async (runtime: ElizaRuntime, _message: unknown, _state: unknown, options?: ActionOptions): Promise<ActionResult> => {
    const agentId = runtime.character?.username || runtime.agentId || 'unknown';
    const agentName = runtime.character?.name || agentId;
    const params = options?.parameters || {};
    const thought = (params.thought || params.text) as string | undefined;

    if (!thought) {
      return { success: false, text: 'No thought specified.' };
    }

    // Store thought in database
    const currentState = getAgentState(agentId);
    if (dbModule && currentState.dbId) {
      try {
        await dbModule.createMessage(
          currentState.dbId,
          'thought',
          thought
        );
      } catch (error) {
        console.error('Error storing thought:', error);
      }
    }

    // Broadcast think event
    if (broadcastFn) {
      broadcastFn({
        type: 'agent_think',
        data: { agent: agentName, agentId, text: thought }
      });
    }

    return {
      success: true,
      text: `Thought: "${thought}"`,
      data: { thought }
    };
  }
};

/**
 * WORK Action - Work on an assigned task or subtask
 * This is where actual code generation happens for coders
 */
const workAction = {
  name: 'WORK',
  description: 'Work on a task or subtask. Coders will generate code, designers create designs, etc.',
  parameters: [
    {
      name: 'taskId',
      description: 'The ID of the task to work on (optional - will pick from assigned tasks)',
      required: false,
      schema: { type: 'number' }
    },
    {
      name: 'output',
      description: 'The work output (code, design, review)',
      required: false,
      schema: { type: 'string' }
    }
  ],
  validate: async (): Promise<boolean> => true,
  handler: async (runtime: ElizaRuntime, _message: unknown, _state: unknown, options?: ActionOptions): Promise<ActionResult> => {
    const agentId = runtime.character?.username || runtime.agentId || 'unknown';
    const agentName = runtime.character?.name || agentId;
    const agentRole = runtime.character?.role || 'coder';
    const params = options?.parameters || {};
    const output = params.output as string | undefined;
    const taskId = params.taskId as number | undefined;

    // Update status to working
    updateAgentState(agentId, {
      status: 'working',
      doing: 'Processing task'
    });

    if (broadcastFn) {
      broadcastFn({
        type: 'agent_status',
        data: { agent: agentName, agentId, status: 'working', doing: 'Processing task' }
      });
    }

    // Generate work output based on role
    let workType = 'generic';
    let workDescription = 'Working on the task';
    const savedFiles: Array<{ name: string; size: number }> = [];

    switch (agentRole) {
      case 'planner':
        workType = 'analysis';
        workDescription = 'Analyzing task and creating plan';
        break;
      case 'designer':
        workType = 'design';
        workDescription = 'Creating design specifications';
        // Save design output if provided
        if (output && storageModule && taskId) {
          try {
            await storageModule.saveTaskFile(taskId, 'design.json', output);
            savedFiles.push({ name: 'design.json', size: output.length });
            if (broadcastFn) {
              broadcastFn({
                type: 'file_created',
                data: { taskId, filename: 'design.json', size: output.length }
              });
            }
          } catch (e) {
            console.error('Failed to save design output:', e);
          }
        }
        break;
      case 'coder':
        workType = 'implementation';
        workDescription = 'Writing code implementation';
        // Save code output if provided
        if (output && storageModule && taskId) {
          try {
            const files = await storageModule.saveCoderOutput(taskId, output);
            for (const file of files) {
              savedFiles.push({ name: file.name, size: file.size });
              if (broadcastFn) {
                broadcastFn({
                  type: 'file_created',
                  data: { taskId, filename: file.name, size: file.size }
                });
              }
            }
          } catch (e) {
            console.error('Failed to save coder output:', e);
          }
        }
        break;
      case 'reviewer':
        workType = 'review';
        workDescription = 'Reviewing code for quality';
        // Save review output if provided
        if (output && storageModule && taskId) {
          try {
            await storageModule.saveTaskFile(taskId, 'review.json', output);
            savedFiles.push({ name: 'review.json', size: output.length });
            if (broadcastFn) {
              broadcastFn({
                type: 'file_created',
                data: { taskId, filename: 'review.json', size: output.length }
              });
            }
          } catch (e) {
            console.error('Failed to save review output:', e);
          }
        }
        break;
    }

    // Simulate work completion after a delay
    setTimeout(() => {
      updateAgentState(agentId, {
        status: 'idle',
        doing: null
      });

      if (broadcastFn) {
        broadcastFn({
          type: 'agent_status',
          data: { agent: agentName, agentId, status: 'idle', doing: '' }
        });
      }
    }, 2000);

    return {
      success: true,
      text: workDescription,
      data: { workType, agentRole, savedFiles }
    };
  }
};

/**
 * WRITE_CODE Action - Specifically for coders to output code
 */
const writeCodeAction = {
  name: 'WRITE_CODE',
  description: 'Write code files for a task. Output will be saved to the task output directory.',
  parameters: [
    {
      name: 'taskId',
      description: 'The task ID this code is for',
      required: true,
      schema: { type: 'number' }
    },
    {
      name: 'filename',
      description: 'The filename to save (e.g., "solution.js", "utils.py")',
      required: true,
      schema: { type: 'string' }
    },
    {
      name: 'code',
      description: 'The code content to write',
      required: true,
      schema: { type: 'string' }
    }
  ],
  validate: async (runtime: ElizaRuntime): Promise<boolean> => {
    return runtime.character?.role === 'coder';
  },
  handler: async (runtime: ElizaRuntime, _message: unknown, _state: unknown, options?: ActionOptions): Promise<ActionResult> => {
    const agentId = runtime.character?.username || runtime.agentId || 'unknown';
    const agentName = runtime.character?.name || agentId;
    const params = options?.parameters || {};
    const taskId = params.taskId as number | undefined;
    const filename = params.filename as string | undefined;
    const code = params.code as string | undefined;

    if (!taskId || !filename || !code) {
      return { success: false, text: 'taskId, filename, and code are required.' };
    }

    // Save the file
    if (storageModule) {
      try {
        const filepath = await storageModule.saveTaskFile(taskId, filename, code);

        if (broadcastFn) {
          broadcastFn({
            type: 'file_created',
            data: { taskId, filename, size: code.length, agent: agentName }
          });
        }

        // Log the code creation
        const currentState = getAgentState(agentId);
        if (dbModule && currentState.dbId) {
          await dbModule.createMessage(
            currentState.dbId,
            'code',
            `Created file: ${filename} (${code.length} bytes)`,
            taskId
          );
        }

        return {
          success: true,
          text: `Created ${filename} (${code.length} bytes)`,
          data: { filepath, filename, size: code.length }
        };
      } catch (error) {
        const err = error as Error;
        console.error('Error saving code:', err);
        return { success: false, text: `Failed to save code: ${err.message}` };
      }
    } else {
      return { success: false, text: 'Storage module not available' };
    }
  }
};

/**
 * ASSIGN_TASK Action - Planners can assign tasks to other agents
 */
const assignTaskAction = {
  name: 'ASSIGN_TASK',
  description: 'Assign a task to another agent (planner action).',
  parameters: [
    {
      name: 'taskId',
      description: 'The task ID to assign',
      required: true,
      schema: { type: 'number' }
    },
    {
      name: 'assignee',
      description: 'The agent name to assign the task to',
      required: true,
      schema: { type: 'string' }
    }
  ],
  validate: async (runtime: ElizaRuntime): Promise<boolean> => {
    // Only planners can assign tasks
    return runtime.character?.role === 'planner';
  },
  handler: async (_runtime: ElizaRuntime, _message: unknown, _state: unknown, options?: ActionOptions): Promise<ActionResult> => {
    const params = options?.parameters || {};
    const taskId = params.taskId as number | undefined;
    const assignee = params.assignee as string | undefined;

    if (!taskId || !assignee) {
      return { success: false, text: 'Task ID and assignee are required.' };
    }

    // Find the assignee's db ID
    let assigneeDbId: number | null = null;
    for (const [, agentState] of agentStates) {
      if (agentState.name?.toLowerCase() === assignee.toLowerCase()) {
        assigneeDbId = agentState.dbId || null;
        break;
      }
    }

    if (!assigneeDbId) {
      return { success: false, text: `Agent "${assignee}" not found.` };
    }

    if (dbModule) {
      try {
        await dbModule.updateTaskStatus(taskId, 'in_progress', assigneeDbId);
      } catch (error) {
        console.error('Error assigning task:', error);
        return { success: false, text: 'Failed to assign task.' };
      }
    }

    return {
      success: true,
      text: `Assigned task ${taskId} to ${assignee}.`,
      data: { taskId, assignee }
    };
  }
};

/**
 * REPLY Action - Alias for SPEAK, responds to messages
 * This is a common action name that ElizaOS autonomy may request
 */
const replyAction = {
  name: 'REPLY',
  description: 'Reply or respond to a message (same as SPEAK).',
  parameters: [
    {
      name: 'message',
      description: 'What to say in response',
      required: true,
      schema: { type: 'string' },
      examples: ['I understand, let me check that.', 'Sure, I can help with that.']
    },
    {
      name: 'target',
      description: 'Optionally direct the message to a specific agent',
      required: false,
      schema: { type: 'string' }
    }
  ],
  validate: async (): Promise<boolean> => true,
  handler: async (runtime: ElizaRuntime, message: unknown, state: unknown, options?: ActionOptions): Promise<ActionResult> => {
    // Delegate to speak action
    return speakAction.handler(runtime, message, state, options);
  }
};

/**
 * CHECK_TASKS Action - Explicitly check and report on assigned tasks
 * This provides an action interface to the TASKS provider
 */
const checkTasksAction = {
  name: 'CHECK_TASKS',
  description: 'Check your assigned tasks and report on them.',
  parameters: [],
  validate: async (): Promise<boolean> => true,
  handler: async (runtime: ElizaRuntime): Promise<ActionResult> => {
    // Use the tasks provider to get task info
    const result = await tasksProvider.get(runtime);
    
    return {
      success: true,
      text: result.text,
      data: result.data
    };
  }
};

/**
 * TASKS Action - Alias for CHECK_TASKS
 * ElizaOS autonomy sometimes requests this as an action
 */
const tasksAction = {
  name: 'TASKS',
  description: 'Check your assigned tasks (alias for CHECK_TASKS).',
  parameters: [],
  validate: async (): Promise<boolean> => true,
  handler: async (runtime: ElizaRuntime): Promise<ActionResult> => {
    return checkTasksAction.handler(runtime);
  }
};

/**
 * WAIT Action - Do nothing for now, idle
 */
const waitAction = {
  name: 'WAIT',
  description: 'Wait and do nothing for now. Use when there is nothing to do.',
  parameters: [],
  validate: async (): Promise<boolean> => true,
  handler: async (runtime: ElizaRuntime): Promise<ActionResult> => {
    const agentId = runtime.character?.username || runtime.agentId || 'unknown';
    const agentName = runtime.character?.name || agentId;
    
    updateAgentState(agentId, {
      status: 'idle',
      doing: null
    });
    
    return {
      success: true,
      text: `${agentName} is waiting.`,
      data: { status: 'idle' }
    };
  }
};

// ============================================================================
// CODE ACTIONS - Shared sandbox file operations
// All agents share ONE sandbox/codebase
// ============================================================================

/**
 * READ_FILE Action - Read a file from the shared codebase
 */
const readFileAction = {
  name: 'READ_FILE',
  description: 'Read a file from the shared codebase. All agents share one workspace.',
  parameters: [
    { name: 'filepath', description: 'Path to the file to read', required: true, schema: { type: 'string' } }
  ],
  validate: async (): Promise<boolean> => process.env.CODER_ENABLED === 'true',
  handler: async (runtime: ElizaRuntime, _message: unknown, _state: unknown, options?: ActionOptions): Promise<ActionResult> => {
    const agentName = runtime.character?.name || 'unknown';
    const params = options?.parameters || {};
    const filepath = params.filepath as string | undefined;

    if (!filepath) {
      return { success: false, text: 'Missing filepath parameter.' };
    }

    try {
      const sandbox = getSharedSandbox();
      const result = await sandbox.readFile(filepath, agentName);

      if (!result.ok) {
        return { success: false, text: result.error || 'Failed to read file' };
      }

      const content = result.content || '';
      const preview = content.length > 500 ? content.slice(0, 500) + '\n...(truncated)' : content;

      return {
        success: true,
        text: `File ${filepath} (${content.length} chars):\n${preview}`,
        data: { filepath, size: content.length, content }
      };
    } catch (error) {
      return { success: false, text: `Error: ${(error as Error).message}` };
    }
  }
};

/**
 * WRITE_FILE Action - Write/create a file in the shared codebase
 */
const writeFileAction = {
  name: 'WRITE_FILE',
  description: 'Write content to a file in the shared codebase. Creates directories if needed.',
  parameters: [
    { name: 'filepath', description: 'Path to the file to write', required: true, schema: { type: 'string' } },
    { name: 'content', description: 'Content to write to the file', required: true, schema: { type: 'string' } }
  ],
  validate: async (): Promise<boolean> => process.env.CODER_ENABLED === 'true',
  handler: async (runtime: ElizaRuntime, _message: unknown, _state: unknown, options?: ActionOptions): Promise<ActionResult> => {
    const agentName = runtime.character?.name || 'unknown';
    const params = options?.parameters || {};
    const filepath = params.filepath as string | undefined;
    const content = params.content as string | undefined;

    if (!filepath) {
      return { success: false, text: 'Missing filepath parameter.' };
    }
    if (content === undefined) {
      return { success: false, text: 'Missing content parameter.' };
    }

    try {
      const sandbox = getSharedSandbox();
      const result = await sandbox.writeFile(filepath, content, agentName);

      if (!result.ok) {
        return { success: false, text: result.error || 'Failed to write file' };
      }

      // Broadcast file change
      if (broadcastFn) {
        broadcastFn({
          type: 'file_created',
          data: { filepath, size: content.length, agent: agentName }
        });
      }

      return {
        success: true,
        text: `Wrote ${filepath} (${content.length} chars)`,
        data: { filepath, size: content.length }
      };
    } catch (error) {
      return { success: false, text: `Error: ${(error as Error).message}` };
    }
  }
};

/**
 * EDIT_FILE Action - Edit a file by replacing text
 */
const editFileAction = {
  name: 'EDIT_FILE',
  description: 'Edit a file by replacing old text with new text.',
  parameters: [
    { name: 'filepath', description: 'Path to the file to edit', required: true, schema: { type: 'string' } },
    { name: 'old_str', description: 'The text to find and replace', required: true, schema: { type: 'string' } },
    { name: 'new_str', description: 'The replacement text', required: true, schema: { type: 'string' } }
  ],
  validate: async (): Promise<boolean> => process.env.CODER_ENABLED === 'true',
  handler: async (runtime: ElizaRuntime, _message: unknown, _state: unknown, options?: ActionOptions): Promise<ActionResult> => {
    const agentName = runtime.character?.name || 'unknown';
    const params = options?.parameters || {};
    const filepath = params.filepath as string | undefined;
    const oldStr = params.old_str as string | undefined;
    const newStr = params.new_str as string | undefined;

    if (!filepath || !oldStr || newStr === undefined) {
      return { success: false, text: 'Missing required parameters (filepath, old_str, new_str).' };
    }

    try {
      const sandbox = getSharedSandbox();
      const result = await sandbox.editFile(filepath, oldStr, newStr, agentName);

      if (!result.ok) {
        return { success: false, text: result.error || 'Failed to edit file' };
      }

      // Broadcast file change
      if (broadcastFn) {
        broadcastFn({
          type: 'file_modified',
          data: { filepath, agent: agentName }
        });
      }

      return {
        success: true,
        text: `Edited ${filepath}`,
        data: { filepath }
      };
    } catch (error) {
      return { success: false, text: `Error: ${(error as Error).message}` };
    }
  }
};

/**
 * LIST_FILES Action - List files in a directory
 */
const listFilesAction = {
  name: 'LIST_FILES',
  description: 'List files and directories in the shared codebase.',
  parameters: [
    { name: 'path', description: 'Directory path (default: current directory)', required: false, schema: { type: 'string' } }
  ],
  validate: async (): Promise<boolean> => process.env.CODER_ENABLED === 'true',
  handler: async (runtime: ElizaRuntime, _message: unknown, _state: unknown, options?: ActionOptions): Promise<ActionResult> => {
    const agentName = runtime.character?.name || 'unknown';
    const params = options?.parameters || {};
    const dirPath = (params.path as string | undefined) || '.';

    try {
      const sandbox = getSharedSandbox();
      const result = await sandbox.listFiles(dirPath, agentName);

      if (!result.ok) {
        return { success: false, text: result.error || 'Failed to list files' };
      }

      const items = result.items || [];
      const dirs = items.filter(i => i.isDirectory).map(i => i.name + '/');
      const files = items.filter(i => !i.isDirectory).map(i => i.name);

      const lines = [`Directory: ${dirPath}`];
      if (dirs.length > 0) lines.push(`Dirs: ${dirs.join(', ')}`);
      if (files.length > 0) lines.push(`Files: ${files.join(', ')}`);
      if (items.length === 0) lines.push('(empty)');

      return {
        success: true,
        text: lines.join('\n'),
        data: { path: dirPath, items }
      };
    } catch (error) {
      return { success: false, text: `Error: ${(error as Error).message}` };
    }
  }
};

/**
 * SEARCH_FILES Action - Search for text in files
 */
const searchFilesAction = {
  name: 'SEARCH_FILES',
  description: 'Search for text patterns in files.',
  parameters: [
    { name: 'pattern', description: 'Text pattern to search for', required: true, schema: { type: 'string' } },
    { name: 'path', description: 'Directory to search in (default: current)', required: false, schema: { type: 'string' } }
  ],
  validate: async (): Promise<boolean> => process.env.CODER_ENABLED === 'true',
  handler: async (runtime: ElizaRuntime, _message: unknown, _state: unknown, options?: ActionOptions): Promise<ActionResult> => {
    const agentName = runtime.character?.name || 'unknown';
    const params = options?.parameters || {};
    const pattern = params.pattern as string | undefined;
    const dirPath = (params.path as string | undefined) || '.';

    if (!pattern) {
      return { success: false, text: 'Missing pattern parameter.' };
    }

    try {
      const sandbox = getSharedSandbox();
      const result = await sandbox.searchFiles(pattern, dirPath, 30, agentName);

      if (!result.ok) {
        return { success: false, text: result.error || 'Search failed' };
      }

      const matches = result.matches || [];
      if (matches.length === 0) {
        return { success: true, text: `No matches found for "${pattern}"`, data: { matches: [] } };
      }

      const lines = [`Found ${matches.length} matches for "${pattern}":`];
      for (const m of matches.slice(0, 20)) {
        lines.push(`  ${m.file}:${m.line}: ${m.content.slice(0, 80)}`);
      }
      if (matches.length > 20) {
        lines.push(`  ... and ${matches.length - 20} more`);
      }

      return {
        success: true,
        text: lines.join('\n'),
        data: { pattern, matches }
      };
    } catch (error) {
      return { success: false, text: `Error: ${(error as Error).message}` };
    }
  }
};

/**
 * EXECUTE_SHELL Action - Run a shell command
 */
const executeShellAction = {
  name: 'EXECUTE_SHELL',
  description: 'Execute a shell command in the shared workspace (npm, git, tsc, etc).',
  parameters: [
    { name: 'command', description: 'The shell command to execute', required: true, schema: { type: 'string' } }
  ],
  validate: async (): Promise<boolean> => process.env.CODER_ENABLED === 'true',
  handler: async (runtime: ElizaRuntime, _message: unknown, _state: unknown, options?: ActionOptions): Promise<ActionResult> => {
    const agentName = runtime.character?.name || 'unknown';
    const params = options?.parameters || {};
    const command = params.command as string | undefined;

    if (!command) {
      return { success: false, text: 'Missing command parameter.' };
    }

    try {
      const sandbox = getSharedSandbox();
      const result = await sandbox.executeShell(command, agentName);

      const output = result.stdout || result.stderr || '(no output)';
      const truncated = output.length > 2000 ? output.slice(0, 2000) + '\n...(truncated)' : output;

      return {
        success: result.success,
        text: `$ ${command}\n${truncated}${result.success ? '' : `\nExit code: ${result.exitCode}`}`,
        data: { command, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
      };
    } catch (error) {
      return { success: false, text: `Error: ${(error as Error).message}` };
    }
  }
};

// ============================================================================
// PLUGIN EXPORT
// ============================================================================

export const elizaTownPlugin = {
  name: 'eliza-town',
  description: 'Custom actions and providers for Eliza Town autonomous agent orchestration',

  providers: [
    townStateProvider,
    tasksProvider,
    nearbyAgentsProvider,
    recentMessagesProvider,
    codebaseProvider
  ],

  actions: [
    moveAction,
    speakAction,
    thinkAction,
    workAction,
    writeCodeAction,
    assignTaskAction,
    replyAction,
    checkTasksAction,
    tasksAction,
    waitAction,
    // Code actions (shared sandbox)
    readFileAction,
    writeFileAction,
    editFileAction,
    listFilesAction,
    searchFilesAction,
    executeShellAction
  ],

  // Plugin initialization
  init: async (_config: unknown, runtime: ElizaRuntime): Promise<void> => {
    console.log(`[eliza-town] Plugin initialized for agent: ${runtime.character?.name || runtime.agentId}`);

    // Store initial agent state
    const agentId = runtime.character?.username || runtime.agentId || 'unknown';
    updateAgentState(agentId, {
      name: runtime.character?.name || agentId,
      role: runtime.character?.role || 'coder',
      status: 'idle',
      hub: getHubForRole(runtime.character?.role || 'coder') || 'town_square',
      x: 0,
      z: 0
    });
  }
};
