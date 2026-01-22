/**
 * Shared type definitions for Eliza Town
 */

import type { Request, Response, NextFunction } from 'express';
import type { WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import type { QueryResult } from 'pg';

// ============================================================================
// Database Types
// ============================================================================

export interface Agent {
  id: number;
  name: string;
  type: AgentRole;
  model_id: string;
  personality: string;
  capabilities: string;
  status: AgentStatus;
  current_hub_id: number | null;
  position_x: number | null;
  position_z: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface Hub {
  id: number;
  name: string;
  display_name: string;
  description: string;
  position_x: number;
  position_z: number;
  created_at: Date;
}

export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: number;
  assigned_agent_id: number | null;
  session_id: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

export interface Subtask {
  id: number;
  task_id: number;
  title: string;
  description: string | null;
  status: SubtaskStatus;
  order_index: number;
  output: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

export interface Message {
  id: number;
  agent_id: number;
  agent_name?: string;
  agent_type?: string;
  type: MessageType;
  content: string;
  task_id: number | null;
  subtask_id: number | null;
  target_agent_id: number | null;
  hub_id: number | null;
  created_at: Date;
}

export interface ApiCall {
  id: number;
  agent_id: number;
  task_id: number | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  prompt_summary: string;
  response_summary: string;
  duration_ms: number;
  created_at: Date;
}

// ============================================================================
// Enums and Status Types
// ============================================================================

export type AgentRole = 'planner' | 'designer' | 'coder' | 'reviewer';
export type AgentStatus = 'idle' | 'working' | 'traveling' | 'chatting' | string;
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | string;
export type SubtaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | string;
export type MessageType = 'thought' | 'chat' | 'saying' | 'status' | 'code' | 'announcement' | string;

// ============================================================================
// Character and Hub Definitions
// ============================================================================

export interface HubDefinition {
  x: number;
  z: number;
  name: string;
  description: string;
}

export interface HubsMap {
  [key: string]: HubDefinition;
}

export interface CharacterSettings {
  AUTONOMY_ENABLED?: boolean;
  AUTONOMY_MODE?: 'task' | 'continuous';
}

export interface CharacterDefinition {
  name: string;
  username: string;
  role: AgentRole;
  modelId: string;
  bio: string[];
  adjectives: string[];
  system: string;
  settings: CharacterSettings;
  capabilities: string[];
}

// ============================================================================
// Agent State Types
// ============================================================================

export interface AgentState {
  dbId?: number;
  name?: string;
  role?: AgentRole;
  status: AgentStatus;
  hub: string;
  x: number;
  z: number;
  doing?: string | null;
  targetHub?: string;
  travelStarted?: number;
  travelTime?: number;
  modelId?: string;
  updatedAt?: number;
}

export interface AgentMetadata {
  dbId: number | null;
  name: string;
  role: AgentRole;
  modelId: string;
}

// ============================================================================
// WebSocket Types
// ============================================================================

export interface WSMessage {
  type: string;
  data?: Record<string, unknown>;
  timestamp?: number;
}

export interface WSStateUpdate {
  agents: Agent[];
  tasks: Task[];
  messages: Message[];
  timestamp: number;
}

export interface WSAgentMove {
  agent: string;
  agentId: string;
  from: { x: number; z: number };
  to: { x: number; z: number };
  hub: string;
}

export interface WSAgentSpeak {
  agent: string;
  agentId: string;
  text: string;
  type?: string;
  thought?: string;
  toAgent?: string | null;
}

export interface WSAgentStatus {
  agent: string;
  agentId: string;
  status: AgentStatus;
  doing: string;
}

export interface WSFileCreated {
  taskId: number;
  filename: string;
  size: number;
  agent?: string;
  filepath?: string;
}

// ============================================================================
// Storage Types
// ============================================================================

export interface SavedFile {
  name: string;
  path: string;
  size: number;
  created?: Date;
}

export interface CoderOutput {
  files?: Array<{
    path?: string;
    name?: string;
    content?: string;
  }>;
}

// ============================================================================
// Orchestration Types
// ============================================================================

export interface OrchestrationOptions {
  db: typeof import('../db/index.js');
  broadcast: BroadcastFn;
  storage?: typeof import('../storage/index.js');
}

export interface ActiveWork {
  taskId: number;
  subtaskId: number;
  startedAt: number;
}

export interface TravelingAgent {
  targetHub: string;
  arrivalTime: number;
}

export interface OrchestrationState {
  isRunning: boolean;
  agents: Array<AgentState & AgentMetadata & { agentId: string }>;
  activeWork: Array<[string, ActiveWork]>;
  travelingAgents: Array<[string, TravelingAgent]>;
}

// ============================================================================
// Runtime Manager Types
// ============================================================================

export interface RuntimeBundle {
  runtime: ElizaRuntime;
  narratorId: string;
  roomId: string;
  worldId: string;
}

export interface TriggerResult {
  didRespond: boolean;
  text: string;
  thought: string;
  actions: string[];
  agentId: string;
  agentName: string;
}

// ============================================================================
// ElizaOS Types (external)
// ============================================================================

// These are simplified type definitions for ElizaOS
// The actual types come from @elizaos/core

export interface ElizaRuntime {
  character?: {
    name?: string;
    username?: string;
    role?: string;
  };
  agentId: string;
  messageService?: {
    handleMessage: (
      runtime: ElizaRuntime,
      message: ElizaMessage,
      callback: (content: ElizaContent) => Promise<unknown[]>
    ) => Promise<ElizaHandleResult>;
  };
  setSetting: (key: string, value: string | boolean, isSecret?: boolean) => void;
  initialize: () => Promise<void>;
  stop: () => Promise<void>;
  ensureConnection: (config: ConnectionConfig) => Promise<void>;
  createMemory: (memory: ElizaMessage, tableName: string) => Promise<void>;
}

export interface ElizaMessage {
  id: string;
  entityId: string;
  roomId: string;
  embedding?: number[];
  content: {
    text: string;
    source?: string;
    channelType?: string;
  };
}

export interface ElizaContent {
  text?: string;
  thought?: string;
  actions?: string[];
  actionCallbacks?: {
    text?: string;
  };
}

export interface ElizaHandleResult {
  didRespond: boolean;
  responseContent?: ElizaContent;
}

export interface ConnectionConfig {
  entityId: string;
  roomId: string;
  worldId: string;
  userName: string;
  source: string;
  channelId: string;
  type: string;
}

// ============================================================================
// Plugin Types
// ============================================================================

export interface PluginProvider {
  name: string;
  description: string;
  get: (
    runtime: ElizaRuntime,
    message: ElizaMessage,
    state: Record<string, unknown>
  ) => Promise<ProviderResult>;
}

export interface ProviderResult {
  text: string;
  values: Record<string, unknown>;
  data: Record<string, unknown>;
}

export interface PluginAction {
  name: string;
  description: string;
  parameters: ActionParameter[];
  validate: (
    runtime: ElizaRuntime,
    message?: ElizaMessage,
    state?: Record<string, unknown>
  ) => Promise<boolean>;
  handler: (
    runtime: ElizaRuntime,
    message: ElizaMessage | null,
    state: Record<string, unknown> | null,
    options?: ActionOptions
  ) => Promise<ActionResult>;
}

export interface ActionParameter {
  name: string;
  description: string;
  required: boolean;
  schema: { type: string };
  examples?: string[];
}

export interface ActionOptions {
  parameters?: Record<string, unknown>;
}

export interface ActionResult {
  success: boolean;
  text: string;
  data?: Record<string, unknown>;
}

export interface ElizaTownPlugin {
  name: string;
  description: string;
  providers: PluginProvider[];
  actions: PluginAction[];
  init?: (config: unknown, runtime: ElizaRuntime) => Promise<void>;
}

// ============================================================================
// Express Extension Types
// ============================================================================

// TypedRequest removed - use inline types with route handlers instead

export type BroadcastFn = (message: WSMessage) => void;

// ============================================================================
// API Types
// ============================================================================

export interface CreateTaskBody {
  title: string;
  description?: string;
  priority?: number;
}

export interface UpdateAgentBody {
  name?: string;
  type?: AgentRole;
  model?: string;
  personality?: string;
  capabilities?: string;
}

export interface MoveAgentBody {
  hubName: string;
}

export interface DecideAgentBody {
  prompt?: string;
}

export interface CreateMessageBody {
  agentId: number;
  type: MessageType;
  content: string;
  taskId?: number;
  subtaskId?: number;
  targetAgentId?: number;
  hubId?: number;
}

export interface CreateSubtaskBody {
  title: string;
  description?: string;
  orderIndex?: number;
}

export interface UpdateTaskBody {
  status?: TaskStatus;
  assignedAgentId?: number;
}

export interface StartOrchestrationBody {
  interval?: number;
}

// ============================================================================
// Health Check Response
// ============================================================================

export interface HealthResponse {
  status: 'ok' | 'error';
  dbAvailable: boolean;
  orchestrationReady: boolean;
  wsInitialized: boolean;
  visualDemoActive: boolean;
  dbError: string | null;
  hasDbUrl: boolean;
  hasOpenAIKey: boolean;
  hasAnthropicKey: boolean;
  hasGroqKey: boolean;
  engine: string;
  timestamp: number;
}
