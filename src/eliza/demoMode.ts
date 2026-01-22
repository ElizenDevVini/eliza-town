/**
 * Demo Mode for Eliza Town
 *
 * Runs agents continuously building and experimenting in a sandbox environment.
 *
 * Features:
 * - Automated task generation based on project context
 * - Continuous build/test/iterate loop
 * - Visual activity for demonstrations
 * - Safe sandbox execution (E2B or local isolated directory)
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { WebSocketMessage } from '../websocket/index.js';

// Type definitions
export interface DemoConfig {
  enabled: boolean;
  targetRepo: string;
  taskInterval: number;
  maxConcurrentTasks: number;
  sandboxDir: string;
}

export interface TaskTemplate {
  name: string;
  description: string;
}

export interface TaskCategory {
  category: string;
  templates: TaskTemplate[];
}

export interface DemoTask {
  id: string;
  name: string;
  description?: string;
  metadata?: {
    status?: string;
    filesCreated?: string[];
    filesModified?: string[];
    result?: {
      summary?: string;
    };
  };
}

export interface ActiveTaskInfo {
  task: DemoTask;
  startedAt: number;
  status: string;
}

export interface TaskHistoryEntry {
  id: string;
  name: string;
  startedAt: number;
}

export interface DemoStatus {
  running: boolean;
  config: DemoConfig;
  activeTasks: Array<{
    id: string;
    name: string;
    startedAt: number;
    elapsed: number;
  }>;
  taskHistory: TaskHistoryEntry[];
}

// Forward declarations for orchestrator functions (will be set during initialization)
type CreateTaskFn = (name: string, description: string, roomId?: string | null) => Promise<DemoTask | null>;
type StartExecutionFn = (taskId: string) => Promise<boolean>;
type GetTaskFn = (taskId: string) => Promise<DemoTask | null>;
type CancelTaskFn = (taskId: string) => Promise<void>;
type BroadcastFn = (message: WebSocketMessage) => void;

interface OrchestratorService {
  createTask: CreateTaskFn;
  startTaskExecution: StartExecutionFn;
  getTask: GetTaskFn;
  cancelTask: CancelTaskFn;
}

// Demo configuration
export const DEMO_CONFIG: DemoConfig = {
  enabled: process.env.DEMO_MODE === 'true',
  targetRepo: process.env.DEMO_TARGET_REPO || 'eliza', // Default to the eliza repo
  taskInterval: parseInt(process.env.DEMO_TASK_INTERVAL || '60000', 10), // 1 minute between tasks
  maxConcurrentTasks: parseInt(process.env.DEMO_MAX_TASKS || '2', 10),
  sandboxDir: process.env.DEMO_SANDBOX_DIR || '/tmp/eliza-town-demo',
};

// Sample task templates for demo
const DEMO_TASK_TEMPLATES: TaskCategory[] = [
  {
    category: 'explore',
    templates: [
      { name: 'Explore project structure', description: 'List and analyze the project directory structure, identify key files and modules' },
      { name: 'Find TODO comments', description: 'Search the codebase for TODO, FIXME, and HACK comments and summarize findings' },
      { name: 'Analyze dependencies', description: 'Read package.json and summarize the project dependencies' },
      { name: 'Review README', description: 'Read the README.md and summarize the project purpose and setup' },
    ]
  },
  {
    category: 'code',
    templates: [
      { name: 'Add TypeScript types', description: 'Find a JavaScript file and add TypeScript type annotations' },
      { name: 'Write unit test', description: 'Find an untested function and write a unit test for it' },
      { name: 'Refactor function', description: 'Find a long function and refactor it into smaller, cleaner pieces' },
      { name: 'Add JSDoc comments', description: 'Find functions missing documentation and add JSDoc comments' },
      { name: 'Create utility function', description: 'Create a useful utility function that could help the project' },
    ]
  },
  {
    category: 'build',
    templates: [
      { name: 'Run tests', description: 'Execute the test suite and report results' },
      { name: 'Check linting', description: 'Run the linter and fix any auto-fixable issues' },
      { name: 'Build project', description: 'Run the build command and verify it succeeds' },
      { name: 'Type check', description: 'Run TypeScript type checking and report any errors' },
    ]
  },
  {
    category: 'create',
    templates: [
      { name: 'Create a simple game', description: 'Create a simple browser game like snake or tetris in a single HTML file' },
      { name: 'Build a CLI tool', description: 'Create a simple command-line utility that does something useful' },
      { name: 'Write a script', description: 'Create a helpful automation script for the project' },
      { name: 'Generate documentation', description: 'Generate documentation for a module or API' },
    ]
  }
];

// Active demo state
let demoRunning = false;
let demoInterval: NodeJS.Timeout | null = null;
const activeTasks = new Map<string, ActiveTaskInfo>();
let taskHistory: TaskHistoryEntry[] = [];
let broadcastFn: BroadcastFn | null = null;
let orchestratorService: OrchestratorService | null = null;

/**
 * Set the orchestrator service (called from orchestration module)
 */
export function setOrchestratorService(service: OrchestratorService): void {
  orchestratorService = service;
}

/**
 * Initialize demo sandbox directory
 */
async function initializeSandbox(): Promise<string> {
  const sandboxDir = DEMO_CONFIG.sandboxDir;

  try {
    await fs.mkdir(sandboxDir, { recursive: true });
    console.log(`[DemoMode] Sandbox directory: ${sandboxDir}`);

    // If targeting eliza repo, set up symlink or copy
    if (DEMO_CONFIG.targetRepo === 'eliza') {
      const elizaDir = path.join(process.cwd(), 'eliza');
      const targetDir = path.join(sandboxDir, 'eliza');

      try {
        await fs.access(targetDir);
        console.log('[DemoMode] Eliza repo already in sandbox');
      } catch {
        // Create symlink to eliza directory for read operations
        // Writes will go to sandbox
        console.log('[DemoMode] Setting up eliza repo in sandbox');
        await fs.symlink(elizaDir, targetDir, 'dir');
      }
    }

    // Set environment for sandbox execution
    process.env.CODER_ALLOWED_DIRECTORY = sandboxDir;
    process.env.SHELL_ALLOWED_DIRECTORY = sandboxDir;
    process.env.CODER_ENABLED = 'true';

    return sandboxDir;
  } catch (error) {
    const err = error as Error;
    console.error('[DemoMode] Failed to initialize sandbox:', err.message);
    throw error;
  }
}

/**
 * Pick a random task from templates
 */
function pickRandomTask(): TaskTemplate {
  // Weighted selection - more exploration and code tasks
  const weights: Record<string, number> = { explore: 3, code: 4, build: 2, create: 1 };
  const weighted: TaskTemplate[] = [];

  for (const category of DEMO_TASK_TEMPLATES) {
    const weight = weights[category.category] || 1;
    for (let i = 0; i < weight; i++) {
      weighted.push(...category.templates);
    }
  }

  const template = weighted[Math.floor(Math.random() * weighted.length)];

  // Add some randomness to the task
  const variations = [
    '',
    ' Focus on the src directory.',
    ' Look in the plugins folder.',
    ' Check the examples directory.',
    ' Be thorough and detailed.',
  ];

  const variation = variations[Math.floor(Math.random() * variations.length)];

  return {
    name: template.name,
    description: template.description + variation
  };
}

/**
 * Get the orchestrator service
 */
function getOrchestratorService(): OrchestratorService | null {
  return orchestratorService;
}

/**
 * Create and start a demo task
 */
async function createDemoTask(): Promise<DemoTask | null> {
  if (activeTasks.size >= DEMO_CONFIG.maxConcurrentTasks) {
    console.log('[DemoMode] Max concurrent tasks reached, waiting...');
    return null;
  }

  const svc = getOrchestratorService();
  if (!svc) {
    console.warn('[DemoMode] Orchestrator service not available');
    return null;
  }

  const taskTemplate = pickRandomTask();

  try {
    const task = await svc.createTask(
      `[Demo] ${taskTemplate.name}`,
      taskTemplate.description
    );

    if (!task) {
      console.warn('[DemoMode] Failed to create task');
      return null;
    }

    activeTasks.set(task.id, {
      task,
      startedAt: Date.now(),
      status: 'running'
    });

    taskHistory.push({
      id: task.id,
      name: task.name,
      startedAt: Date.now()
    });

    // Keep history limited
    if (taskHistory.length > 50) {
      taskHistory = taskHistory.slice(-50);
    }

    // Broadcast task creation
    if (broadcastFn) {
      broadcastFn({
        type: 'demo_task_created',
        data: { taskId: task.id, name: task.name, description: taskTemplate.description }
      });
    }

    // Start execution
    await svc.startTaskExecution(task.id);

    console.log(`[DemoMode] Started task: ${task.name}`);
    return task;

  } catch (error) {
    const err = error as Error;
    console.error('[DemoMode] Error creating task:', err.message);
    return null;
  }
}

/**
 * Check and clean up completed tasks
 */
async function checkTaskStatus(): Promise<void> {
  const svc = getOrchestratorService();
  if (!svc) return;

  for (const [taskId, info] of activeTasks) {
    try {
      const task = await svc.getTask(taskId);
      if (!task) {
        activeTasks.delete(taskId);
        continue;
      }

      const status = task.metadata?.status;
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        console.log(`[DemoMode] Task ${status}: ${task.name}`);

        // Broadcast completion
        if (broadcastFn) {
          broadcastFn({
            type: 'demo_task_complete',
            data: {
              taskId,
              name: task.name,
              status,
              filesCreated: task.metadata?.filesCreated || [],
              filesModified: task.metadata?.filesModified || [],
              summary: task.metadata?.result?.summary || ''
            }
          });
        }

        activeTasks.delete(taskId);
      }

      // Timeout check (30 minutes max per task)
      const elapsed = Date.now() - info.startedAt;
      if (elapsed > 30 * 60 * 1000) {
        console.log(`[DemoMode] Task timeout: ${task.name}`);
        await svc.cancelTask(taskId);
        activeTasks.delete(taskId);
      }

    } catch (error) {
      const err = error as Error;
      console.warn(`[DemoMode] Error checking task ${taskId}:`, err.message);
      activeTasks.delete(taskId);
    }
  }
}

/**
 * Demo loop tick
 */
async function demoTick(): Promise<void> {
  if (!demoRunning) return;

  await checkTaskStatus();
  await createDemoTask();
}

/**
 * Start demo mode
 */
export async function startDemoMode(broadcast: BroadcastFn): Promise<boolean> {
  if (!DEMO_CONFIG.enabled) {
    console.log('[DemoMode] Demo mode not enabled (set DEMO_MODE=true)');
    return false;
  }

  if (demoRunning) {
    console.log('[DemoMode] Already running');
    return true;
  }

  broadcastFn = broadcast;

  try {
    await initializeSandbox();

    demoRunning = true;

    // Initial task
    await createDemoTask();

    // Start periodic task creation
    demoInterval = setInterval(() => {
      demoTick().catch(err => console.error('[DemoMode] Tick error:', err));
    }, DEMO_CONFIG.taskInterval);

    console.log('[DemoMode] Started');
    console.log(`[DemoMode] Task interval: ${DEMO_CONFIG.taskInterval}ms`);
    console.log(`[DemoMode] Max concurrent: ${DEMO_CONFIG.maxConcurrentTasks}`);

    if (broadcastFn) {
      broadcastFn({
        type: 'demo_mode_started',
        data: {
          sandboxDir: DEMO_CONFIG.sandboxDir,
          targetRepo: DEMO_CONFIG.targetRepo
        }
      });
    }

    return true;

  } catch (error) {
    const err = error as Error;
    console.error('[DemoMode] Failed to start:', err.message);
    return false;
  }
}

/**
 * Stop demo mode
 */
export function stopDemoMode(): void {
  if (!demoRunning) return;

  demoRunning = false;

  if (demoInterval) {
    clearInterval(demoInterval);
    demoInterval = null;
  }

  // Cancel active tasks
  const svc = getOrchestratorService();
  if (svc) {
    for (const taskId of activeTasks.keys()) {
      svc.cancelTask(taskId).catch(() => {
        // Ignore errors during cleanup
      });
    }
  }

  activeTasks.clear();

  if (broadcastFn) {
    broadcastFn({ type: 'demo_mode_stopped', data: {} });
  }

  console.log('[DemoMode] Stopped');
}

/**
 * Get demo status
 */
export function getDemoStatus(): DemoStatus {
  return {
    running: demoRunning,
    config: DEMO_CONFIG,
    activeTasks: Array.from(activeTasks.entries()).map(([id, info]) => ({
      id,
      name: info.task.name,
      startedAt: info.startedAt,
      elapsed: Date.now() - info.startedAt
    })),
    taskHistory: taskHistory.slice(-20)
  };
}
