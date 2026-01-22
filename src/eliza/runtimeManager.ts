/**
 * ElizaOS Runtime Manager for Eliza Town
 *
 * This module manages real ElizaOS AgentRuntime instances using the
 * canonical handleMessage paradigm for all AI-driven decisions.
 */

import { ELIZA_TOWN_CHARACTERS, getHubForRole, HUBS } from './characters.js';
import { elizaTownPlugin, initializePlugin, updateAgentState, getAgentState, setMemoryBroadcastFn } from './elizaTownPlugin.js';
import { initializeSharedSandbox, closeSharedSandbox } from './sharedSandbox.js';
import type {
  BroadcastFn,
  RuntimeBundle,
  AgentMetadata,
  TriggerResult,
  AgentRole,
} from '../types/index.js';

// Map of agentId -> RuntimeBundle
const runtimeBundles = new Map<string, RuntimeBundle>();

// Map of agentId -> agent metadata
const agentMetadata = new Map<string, AgentMetadata>();

// External dependencies (set during initialization)
let dbModule: typeof import('../db/index.js') | null = null;
let broadcastFn: BroadcastFn | null = null;
let storageModule: typeof import('../storage/index.js') | null = null;

// ElizaOS imports (loaded dynamically)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let AgentRuntime: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ChannelType: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createMessageMemory: any = null;
let stringToUuid: ((s: string) => string) | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let LLMMode: any = null;

// Track if we're initialized
let initialized = false;

// Shared world/room IDs
let sharedWorldId: string | null = null;
let narratorId: string | null = null;

interface InitializeOptions {
  db?: typeof import('../db/index.js') | null;
  broadcast?: BroadcastFn | null;
  storage?: typeof import('../storage/index.js') | null;
}

/**
 * Initialize the runtime manager
 */
export async function initialize(options: InitializeOptions = {}): Promise<void> {
  if (initialized) {
    console.log('[RuntimeManager] Already initialized');
    return;
  }

  dbModule = options.db || null;
  broadcastFn = options.broadcast || null;
  storageModule = options.storage || null;

  // Initialize the plugin with external dependencies
  initializePlugin(dbModule, broadcastFn, storageModule);

  // Load ElizaOS core
  try {
    const core = await import('@elizaos/core');
    AgentRuntime = core.AgentRuntime;
    ChannelType = core.ChannelType;
    createMessageMemory = core.createMessageMemory;
    stringToUuid = core.stringToUuid;
    LLMMode = core.LLMMode;

    sharedWorldId = stringToUuid!('eliza-town-world');
    narratorId = stringToUuid!('eliza-town-narrator');

    console.log('[RuntimeManager] ✓ ElizaOS core loaded');
  } catch (error) {
    console.error('[RuntimeManager] Failed to load ElizaOS core:', (error as Error).message);
    throw error;
  }

  // Initialize the shared sandbox (all agents share one sandbox)
  if (process.env.CODER_ENABLED === 'true') {
    try {
      await initializeSharedSandbox(broadcastFn || undefined);
      console.log('[RuntimeManager] ✓ Shared sandbox initialized (all agents share one workspace)');
    } catch (error) {
      console.warn('[RuntimeManager] Shared sandbox not available:', (error as Error).message);
    }
  }

  initialized = true;
  console.log('[RuntimeManager] Initialization complete');
}

interface PluginConfig {
  env: string;
  module: string;
  name: string;
  id: string;
}

/**
 * Build plugins array based on available API keys
 */
async function buildPlugins(): Promise<unknown[]> {
  const plugins: unknown[] = [elizaTownPlugin];

  const providerConfigs: PluginConfig[] = [
    { env: 'GROQ_API_KEY', module: '@elizaos/plugin-groq', name: 'Groq', id: 'groq' },
    { env: 'ANTHROPIC_API_KEY', module: '@elizaos/plugin-anthropic', name: 'Anthropic', id: 'anthropic' },
    { env: 'OPENAI_API_KEY', module: '@elizaos/plugin-openai', name: 'OpenAI', id: 'openai' },
  ];

  const preferredProvider = process.env.LLM_PROVIDER?.toLowerCase();

  const configsToLoad = preferredProvider
    ? providerConfigs.filter((c) => c.id === preferredProvider)
    : providerConfigs;

  for (const config of configsToLoad) {
    if (process.env[config.env]) {
      try {
        const mod = await import(config.module);
        const plugin = mod.default || mod;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { tests, ...rest } = plugin;
        plugins.push(rest);
        console.log(`[RuntimeManager] ✓ ${config.name} plugin loaded`);
      } catch (error) {
        console.warn(`[RuntimeManager] Could not load ${config.name}:`, (error as Error).message);
      }
    }
  }

  // NOTE: Code actions (READ_FILE, WRITE_FILE, EDIT_FILE, LIST_FILES, SEARCH_FILES, EXECUTE_SHELL)
  // are now provided directly by elizaTownPlugin using the shared sandbox.
  // This ensures all agents share ONE codebase and can see each other's changes.
  // The external @elizaos/plugin-code and @elizaos/plugin-shell are not needed.
  if (process.env.CODER_ENABLED === 'true') {
    console.log('[RuntimeManager] ✓ Code actions enabled via elizaTownPlugin (shared sandbox)');
  }

  const hasDatabase = !!process.env.DATABASE_URL;

  if (hasDatabase) {
    try {
      const sqlModule = await import('@elizaos/plugin-sql');
      const sqlPlugin = sqlModule.default || sqlModule.plugin;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { tests, ...rest } = sqlPlugin;
      plugins.push(rest);
      console.log('[RuntimeManager] ✓ SQL plugin loaded');
    } catch (error) {
      console.warn('[RuntimeManager] SQL plugin not available:', (error as Error).message);
    }
  } else {
    try {
      const inmemModule = await import('@elizaos/plugin-inmemorydb');
      const inmemPlugin = inmemModule.default || inmemModule.plugin;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { tests, ...rest } = inmemPlugin;
      plugins.push(rest);
      console.log('[RuntimeManager] ✓ InMemoryDB plugin loaded (no DATABASE_URL)');
    } catch (error) {
      console.warn('[RuntimeManager] InMemoryDB plugin not available:', (error as Error).message);
    }
  }

  if (hasDatabase) {
    try {
      const goalsModule = await import('@elizaos/plugin-goals');
      const goalsPlugin = goalsModule.default || goalsModule.GoalsPlugin;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { tests, ...rest } = goalsPlugin;
      plugins.push(rest);
      console.log('[RuntimeManager] ✓ Goals plugin loaded');
    } catch (error) {
      console.warn('[RuntimeManager] Goals plugin not available:', (error as Error).message);
    }

    try {
      const todoModule = await import('@elizaos/plugin-todo');
      const todoPlugin = todoModule.default || todoModule.todoPlugin;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { tests, ...rest } = todoPlugin;
      plugins.push(rest);
      console.log('[RuntimeManager] ✓ Todo plugin loaded');
    } catch (error) {
      console.warn('[RuntimeManager] Todo plugin not available:', (error as Error).message);
    }
  } else {
    console.log('[RuntimeManager] Skipping Goals/Todo plugins (no DATABASE_URL)');
  }

  return plugins;
}

interface CharacterConfig {
  name: string;
  username: string;
  bio: string[];
  adjectives: string[];
  system: string;
  settings: {
    AUTONOMY_ENABLED?: boolean;
    AUTONOMY_MODE?: string;
  };
}

/**
 * Build character definition for ElizaOS
 */
function buildCharacter(charDef: typeof ELIZA_TOWN_CHARACTERS[number]): CharacterConfig {
  return {
    name: charDef.name,
    username: charDef.username,
    bio: charDef.bio,
    adjectives: charDef.adjectives,
    system: charDef.system,
    settings: {
      ...charDef.settings,
      AUTONOMY_ENABLED: true,
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applySettings(runtime: any): void {
  runtime.setSetting('CHECK_SHOULD_RESPOND', false);

  if (process.env.OPENAI_API_KEY) {
    runtime.setSetting('OPENAI_API_KEY', process.env.OPENAI_API_KEY, true);
    runtime.setSetting('OPENAI_SMALL_MODEL', process.env.OPENAI_SMALL_MODEL || 'gpt-4o-mini');
    runtime.setSetting('OPENAI_LARGE_MODEL', process.env.OPENAI_LARGE_MODEL || 'gpt-4o');
  }

  if (process.env.ANTHROPIC_API_KEY) {
    runtime.setSetting('ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY, true);
    runtime.setSetting(
      'ANTHROPIC_SMALL_MODEL',
      process.env.ANTHROPIC_SMALL_MODEL || 'claude-3-5-haiku-20241022'
    );
    runtime.setSetting(
      'ANTHROPIC_LARGE_MODEL',
      process.env.ANTHROPIC_LARGE_MODEL || 'claude-sonnet-4-20250514'
    );
  }

  if (process.env.GROQ_API_KEY) {
    runtime.setSetting('GROQ_API_KEY', process.env.GROQ_API_KEY, true);
    runtime.setSetting('GROQ_SMALL_MODEL', process.env.GROQ_SMALL_MODEL || 'llama-3.1-8b-instant');
    runtime.setSetting('GROQ_LARGE_MODEL', process.env.GROQ_LARGE_MODEL || 'llama-3.3-70b-versatile');
  }
}

/**
 * Get or create runtime for an agent
 */
async function getRuntimeForAgent(agentId: string): Promise<RuntimeBundle> {
  const existing = runtimeBundles.get(agentId);
  if (existing) {
    return existing;
  }

  const charDef = ELIZA_TOWN_CHARACTERS.find((c) => c.username === agentId);
  if (!charDef) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  const plugins = await buildPlugins();

  const runtime = new AgentRuntime({
    character: buildCharacter(charDef),
    plugins,
    actionPlanning: true,
    logLevel: 'info',
    enableAutonomy: true,
    llmMode: LLMMode?.SMALL,
  });

  applySettings(runtime);

  await runtime.initialize();

  const roomId = stringToUuid!(`eliza-town-room-${agentId}`);
  await runtime.ensureConnection({
    entityId: narratorId,
    roomId,
    worldId: sharedWorldId,
    userName: 'Town Narrator',
    source: 'eliza-town',
    channelId: 'eliza-town',
    type: ChannelType?.GROUP || 'GROUP',
  });

  const bundle: RuntimeBundle = {
    runtime,
    narratorId: narratorId!,
    roomId,
    worldId: sharedWorldId!,
  };

  runtimeBundles.set(agentId, bundle);
  console.log(`[RuntimeManager] Created runtime for ${charDef.name} (${agentId})`);

  return bundle;
}

/**
 * Initialize all agents from characters
 */
export async function initializeAgents(): Promise<void> {
  if (!initialized) {
    throw new Error('RuntimeManager not initialized');
  }

  let dbAgents: Array<{ id: number; name: string; type: string; status: string; model_id: string }> = [];
  if (dbModule) {
    try {
      dbAgents = await dbModule.getAgents();
    } catch (error) {
      console.error('[RuntimeManager] Error fetching agents:', error);
    }
  }

  for (const character of ELIZA_TOWN_CHARACTERS) {
    const dbAgent = dbAgents.find(
      (a) => a.name.toLowerCase() === character.name.toLowerCase() || a.type === character.role
    );
    const dbId = dbAgent?.id || null;

    try {
      await getRuntimeForAgent(character.username);

      agentMetadata.set(character.username, {
        dbId,
        name: character.name,
        role: character.role,
        modelId: character.modelId,
      });

      const initialHub = getHubForRole(character.role);
      updateAgentState(character.username, {
        dbId: dbId || undefined,
        name: character.name,
        role: character.role,
        status: 'idle',
        hub: initialHub,
        x: HUBS[initialHub]?.x || 0,
        z: HUBS[initialHub]?.z || 0,
      });
    } catch (error) {
      console.error(`[RuntimeManager] Failed to create runtime for ${character.name}:`, error);
    }
  }

  console.log(`[RuntimeManager] Initialized ${runtimeBundles.size} agent runtimes`);

  // Wire up the memory broadcast function so agents can "hear" each other
  // This is the canonical ElizaOS pattern for agent-to-agent communication
  setMemoryBroadcastFn(broadcastToAllAgents);
  console.log('[RuntimeManager] Agent-to-agent memory sharing enabled');
}

/**
 * Get runtime for an agent
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getRuntime(agentId: string): any {
  const bundle = runtimeBundles.get(agentId);
  return bundle?.runtime;
}

/**
 * Get all runtimes
 */
export function getAllRuntimes(): Map<string, RuntimeBundle> {
  return runtimeBundles;
}

/**
 * Get agent metadata
 */
export function getMetadata(agentId: string): AgentMetadata | undefined {
  return agentMetadata.get(agentId);
}

/**
 * Re-export stringToUuid for external use
 */
export function getStringToUuid(): ((s: string) => string) | null {
  return stringToUuid;
}

/**
 * Trigger an agent decision using ElizaOS handleMessage
 */
export async function triggerAgentDecision(
  agentId: string,
  prompt: string,
  _options: Record<string, unknown> = {}
): Promise<TriggerResult | null> {
  const bundle = await getRuntimeForAgent(agentId);
  const { runtime, narratorId: narId, roomId } = bundle;

  if (!runtime.messageService) {
    console.error(`[RuntimeManager] No messageService for ${agentId}`);
    return null;
  }

  const metadata = agentMetadata.get(agentId);
  const agentName = metadata?.name || agentId;

  const messageId = stringToUuid!(
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`
  );
  const message = createMessageMemory!({
    id: messageId,
    entityId: narId,
    roomId,
    embedding: [],
    content: {
      text: prompt,
      source: 'eliza-town',
      channelType: ChannelType?.GROUP || 'GROUP',
    },
  });

  let responseText = '';
  let responseThought = '';
  let actionsExecuted: string[] = [];

  try {
    const result = await runtime.messageService.handleMessage(
      runtime,
      message,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (content: any) => {
        if (typeof content.text === 'string') {
          responseText = content.text;
        }
        if (typeof content.thought === 'string') {
          responseThought = content.thought;
        }
        if (content.actions) {
          actionsExecuted = content.actions;
        }
        return [];
      }
    );

    const responseContent = result.responseContent;
    if (!responseText && typeof responseContent?.text === 'string') {
      responseText = responseContent.text;
    }
    if (!responseThought && typeof responseContent?.thought === 'string') {
      responseThought = responseContent.thought;
    }
    if (!responseText && responseContent?.actionCallbacks?.text) {
      responseText = responseContent.actionCallbacks.text;
    }

    if (responseText?.trim()) {
      // Broadcast to WebSocket for frontend
      if (broadcastFn) {
        broadcastFn({
          type: 'agent_speak',
          data: {
            agent: agentName,
            agentId,
            text: responseText,
            thought: responseThought,
            type: 'saying',
          },
        });
      }

      // Broadcast to all other agents' ElizaOS memories
      // This is what makes agents actually "hear" each other
      broadcastToAllAgents(agentId, responseText, 'speech').catch((err) => {
        console.error(`[RuntimeManager] Failed to broadcast to other agents:`, err);
      });
    }

    console.log(
      `[RuntimeManager] ${agentName} responded: ${result.didRespond}, text: ${responseText?.substring(0, 50)}...`
    );

    return {
      didRespond: result.didRespond,
      text: responseText,
      thought: responseThought,
      actions: actionsExecuted,
      agentId,
      agentName,
    };
  } catch (error) {
    console.error(`[RuntimeManager] handleMessage error for ${agentName}:`, error);
    return null;
  }
}

/**
 * Trigger a move decision
 */
export async function triggerMoveDecision(agentId: string): Promise<TriggerResult | null> {
  const state = getAgentState(agentId);
  const prompt = `
Decide your next move in Eliza Town.
You are at ${HUBS[state.hub]?.name || state.hub}.

Check TASKS for your assigned work.
Check TOWN_STATE for what's happening around you.
Check NEARBY_AGENTS for who is close by.

Use the MOVE action to go to a hub or toward an agent.
Use SPEAK to announce your intentions.

Available hubs: town_square, planning_room, design_studio, coding_desk, review_station, deploy_station

Choose your action.
`;
  return triggerAgentDecision(agentId, prompt);
}

/**
 * Trigger a chat decision
 */
export async function triggerChatDecision(
  agentId: string,
  context: string = ''
): Promise<TriggerResult | null> {
  const prompt = `
${context || 'You have a moment of free time in Eliza Town.'}

Check NEARBY_AGENTS to see who is close by.

Consider:
- Share an observation using SPEAK
- Comment on recent activity
- Use THINK for internal reflection

Keep responses brief and natural.
`;
  return triggerAgentDecision(agentId, prompt);
}

/**
 * Trigger a work decision
 */
export async function triggerWorkDecision(
  agentId: string,
  taskContext: string = ''
): Promise<TriggerResult | null> {
  const metadata = agentMetadata.get(agentId);
  const role = metadata?.role || 'coder';

  const prompt = `
${taskContext || 'Check your assigned tasks.'}

Check TASKS to see your current assignments.

As a ${role}, you should:
${role === 'planner' ? '- Analyze tasks and break them into subtasks\n- Assign work to team members' : ''}
${role === 'designer' ? '- Create design specifications\n- Define architecture' : ''}
${role === 'coder' ? '- Implement code based on designs\n- Handle edge cases' : ''}
${role === 'reviewer' ? '- Review code for quality\n- Provide feedback' : ''}

Use WORK to process tasks.
Use SPEAK to communicate progress.
Use MOVE if needed.
`;
  return triggerAgentDecision(agentId, prompt);
}

/**
 * Broadcast a message to ALL agents' ElizaOS memories
 * This is the canonical pattern from examples/town for agent-to-agent communication
 * Yes, it's O(n^2) but that's fine for small numbers of agents
 */
export async function broadcastToAllAgents(
  authorId: string,
  text: string,
  messageType: 'speech' | 'thought' | 'action' = 'speech'
): Promise<void> {
  if (!initialized || !stringToUuid || !createMessageMemory) {
    console.warn('[RuntimeManager] Not initialized, cannot broadcast');
    return;
  }

  const authorMetadata = agentMetadata.get(authorId);
  const authorName = authorMetadata?.name || authorId;
  const authorEntityId = stringToUuid(authorId);

  // Get all agent IDs except the author
  const recipientIds = Array.from(runtimeBundles.keys()).filter((id) => id !== authorId);

  if (recipientIds.length === 0) {
    return;
  }

  console.log(
    `[RuntimeManager] Broadcasting "${text.substring(0, 30)}..." from ${authorName} to ${recipientIds.length} agents`
  );

  // Write the message to each recipient's memory
  const writePromises = recipientIds.map(async (recipientId) => {
    try {
      const bundle = runtimeBundles.get(recipientId);
      if (!bundle) return;

      const { runtime, roomId, worldId } = bundle;

      // Ensure the author exists as an entity in this agent's runtime
      await runtime.ensureConnection({
        entityId: authorEntityId,
        roomId,
        worldId,
        userName: authorName,
        source: 'eliza-town',
        channelId: 'eliza-town',
        type: ChannelType?.GROUP || 'GROUP',
      });

      // Create a memory of the author's message in this agent's room
      const messageId = stringToUuid!(
        `${authorId}-${recipientId}-${Date.now()}-${Math.random()}`
      );

      const memory = createMessageMemory!({
        id: messageId,
        entityId: authorEntityId,
        agentId: runtime.agentId,
        roomId,
        embedding: [],
        content: {
          text: messageType === 'speech' ? `${authorName} said: "${text}"` : text,
          source: 'eliza-town',
          channelType: ChannelType?.GROUP || 'GROUP',
          metadata: {
            authorId,
            authorName,
            messageType,
            timestamp: Date.now(),
          },
        },
      });

      // Store in the agent's messages table
      await runtime.createMemory(memory, 'messages');
    } catch (error) {
      console.error(
        `[RuntimeManager] Failed to write memory to ${recipientId}:`,
        (error as Error).message
      );
    }
  });

  await Promise.all(writePromises);
  console.log(`[RuntimeManager] Broadcast complete to ${recipientIds.length} agents`);
}

/**
 * Get nearby agents (same hub) for targeted broadcasts
 */
export function getNearbyAgentIds(authorId: string): string[] {
  const authorState = getAgentState(authorId);
  const authorHub = authorState.hub || 'town_square';

  const nearbyIds: string[] = [];
  for (const [agentId] of runtimeBundles) {
    if (agentId === authorId) continue;
    const state = getAgentState(agentId);
    if (state.hub === authorHub) {
      nearbyIds.push(agentId);
    }
  }
  return nearbyIds;
}

/**
 * Broadcast to nearby agents only (same hub)
 */
export async function broadcastToNearbyAgents(
  authorId: string,
  text: string,
  messageType: 'speech' | 'thought' | 'action' = 'speech'
): Promise<void> {
  if (!initialized || !stringToUuid || !createMessageMemory) {
    return;
  }

  const authorMetadata = agentMetadata.get(authorId);
  const authorName = authorMetadata?.name || authorId;
  const authorEntityId = stringToUuid(authorId);
  const nearbyIds = getNearbyAgentIds(authorId);

  if (nearbyIds.length === 0) {
    return;
  }

  console.log(
    `[RuntimeManager] Broadcasting to ${nearbyIds.length} nearby agents from ${authorName}`
  );

  const writePromises = nearbyIds.map(async (recipientId) => {
    try {
      const bundle = runtimeBundles.get(recipientId);
      if (!bundle) return;

      const { runtime, roomId, worldId } = bundle;

      await runtime.ensureConnection({
        entityId: authorEntityId,
        roomId,
        worldId,
        userName: authorName,
        source: 'eliza-town',
        channelId: 'eliza-town',
        type: ChannelType?.GROUP || 'GROUP',
      });

      const messageId = stringToUuid!(
        `${authorId}-${recipientId}-${Date.now()}-${Math.random()}`
      );

      const memory = createMessageMemory!({
        id: messageId,
        entityId: authorEntityId,
        agentId: runtime.agentId,
        roomId,
        embedding: [],
        content: {
          text: messageType === 'speech' ? `${authorName} said: "${text}"` : text,
          source: 'eliza-town',
          channelType: ChannelType?.GROUP || 'GROUP',
          metadata: {
            authorId,
            authorName,
            messageType,
            timestamp: Date.now(),
          },
        },
      });

      await runtime.createMemory(memory, 'messages');
    } catch (error) {
      console.error(
        `[RuntimeManager] Failed to write memory to ${recipientId}:`,
        (error as Error).message
      );
    }
  });

  await Promise.all(writePromises);
}

/**
 * Stop all runtimes
 */
export async function stopAll(): Promise<void> {
  console.log('[RuntimeManager] Stopping all runtimes...');

  const bundles = Array.from(runtimeBundles.values());
  runtimeBundles.clear();

  for (const bundle of bundles) {
    try {
      await bundle.runtime.stop();
    } catch (error) {
      console.error('[RuntimeManager] Error stopping runtime:', error);
    }
  }

  // Close shared sandbox
  try {
    await closeSharedSandbox();
    console.log('[RuntimeManager] Shared sandbox closed');
  } catch (error) {
    console.error('[RuntimeManager] Error closing shared sandbox:', error);
  }

  agentMetadata.clear();
  initialized = false;

  console.log('[RuntimeManager] All runtimes stopped');
}
