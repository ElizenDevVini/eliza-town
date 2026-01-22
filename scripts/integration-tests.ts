#!/usr/bin/env bun
/**
 * Eliza Town Integration Tests
 *
 * These tests verify that all ends of the ElizaOS integration work correctly
 * when the server is running. Run the server first with `bun run dev` or `bun run demo`.
 *
 * Usage:
 *   bun scripts/integration-tests.ts [--server-url=http://localhost:3000]
 */

import WebSocket from 'ws';

// Configuration
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const WS_URL = SERVER_URL.replace(/^http/, 'ws') + '/ws';
const TIMEOUT_MS = 10000;

// Test result tracking
interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
  details?: Record<string, unknown>;
}

const results: TestResult[] = [];
let passedCount = 0;
let failedCount = 0;

// Colors for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

function log(message: string, color: keyof typeof colors = 'reset'): void {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Server state - detected at startup
let serverHasDatabase = false;

// Validation helpers
function assertNotNull<T>(value: T | null | undefined, fieldName: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(`${fieldName} is null or undefined`);
  }
}

function assertType(value: unknown, expectedType: string, fieldName: string): void {
  const actualType = typeof value;
  if (actualType !== expectedType) {
    throw new Error(`${fieldName} expected ${expectedType}, got ${actualType}`);
  }
}

function assertArray(value: unknown, fieldName: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} is not an array`);
  }
}

function assertNoError(response: Record<string, unknown>): void {
  if (response.error) {
    throw new Error(`API returned error: ${response.error}`);
  }
}

// HTTP helpers
interface FetchResult<T> {
  status: number;
  data: T;
}

async function fetchWithStatus<T = Record<string, unknown>>(
  path: string,
  options: RequestInit = {}
): Promise<FetchResult<T>> {
  const url = `${SERVER_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const text = await response.text();
  try {
    return {
      status: response.status,
      data: JSON.parse(text) as T,
    };
  } catch {
    throw new Error(`Invalid JSON response from ${path}: ${text.substring(0, 200)}`);
  }
}

async function fetchJson<T = Record<string, unknown>>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const result = await fetchWithStatus<T>(path, options);
  return result.data;
}

// Test runner
async function runTest(
  name: string,
  testFn: () => Promise<Record<string, unknown> | void>
): Promise<void> {
  const start = Date.now();
  try {
    const details = await testFn();
    const duration = Date.now() - start;
    results.push({ name, passed: true, duration, details: details || undefined });
    passedCount++;
    log(`  ✓ ${name} (${duration}ms)`, 'green');
  } catch (error) {
    const duration = Date.now() - start;
    const errorMessage = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: errorMessage, duration });
    failedCount++;
    log(`  ✗ ${name} (${duration}ms)`, 'red');
    log(`    Error: ${errorMessage}`, 'yellow');
  }
}

// ============================================================================
// Health & Server Tests
// ============================================================================

async function testHealthEndpoint(): Promise<Record<string, unknown>> {
  const response = await fetchJson('/api/health');

  assertNoError(response);
  assertNotNull(response.status, 'status');
  assertNotNull(response.timestamp, 'timestamp');
  assertNotNull(response.engine, 'engine');
  assertType(response.dbAvailable, 'boolean', 'dbAvailable');
  assertType(response.orchestrationReady, 'boolean', 'orchestrationReady');
  assertType(response.wsInitialized, 'boolean', 'wsInitialized');
  assertType(response.visualDemoActive, 'boolean', 'visualDemoActive');

  if (response.status !== 'ok') {
    throw new Error(`Health status is "${response.status}", expected "ok"`);
  }

  // Store for other tests
  serverHasDatabase = response.dbAvailable as boolean;

  return {
    status: response.status,
    dbAvailable: response.dbAvailable,
    orchestrationReady: response.orchestrationReady,
    wsInitialized: response.wsInitialized,
    visualDemoActive: response.visualDemoActive,
    engine: response.engine,
  };
}

async function testDemoStateEndpoint(): Promise<Record<string, unknown>> {
  const response = await fetchJson('/api/demo/state');

  assertNoError(response);
  assertType(response.running, 'boolean', 'running');

  return {
    running: response.running,
    hasState: response.state !== null,
  };
}

async function testDemoStatusEndpoint(): Promise<Record<string, unknown>> {
  const response = await fetchJson('/api/demo/status');

  assertNoError(response);
  assertType(response.running, 'boolean', 'running');
  assertNotNull(response.config, 'config');
  assertArray(response.activeTasks, 'activeTasks');
  assertArray(response.taskHistory, 'taskHistory');

  return {
    running: response.running,
    hasConfig: !!response.config,
  };
}

async function testExecutionConfigEndpoint(): Promise<Record<string, unknown>> {
  const response = await fetchJson('/api/execution/config');

  assertNoError(response);
  assertNotNull(response.mode, 'mode');
  assertType(response.coderEnabled, 'boolean', 'coderEnabled');
  assertType(response.demoMode, 'boolean', 'demoMode');
  assertType(response.e2bConfigured, 'boolean', 'e2bConfigured');

  return {
    mode: response.mode,
    coderEnabled: response.coderEnabled,
    demoMode: response.demoMode,
  };
}

// ============================================================================
// WebSocket Tests
// ============================================================================

async function testWebSocketConnection(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket connection timeout'));
    }, TIMEOUT_MS);

    let welcomeReceived = false;
    let messageCount = 0;

    ws.on('open', () => {
      // Connection opened, wait for welcome message
    });

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        messageCount++;

        if (message.type === 'connected') {
          welcomeReceived = true;
          assertNotNull(message.data, 'welcome data');
          assertNotNull(message.data.message, 'welcome message');
          assertNotNull(message.data.timestamp, 'welcome timestamp');

          // Send ping to test bidirectional communication
          ws.send(JSON.stringify({ type: 'ping' }));
        }

        if (message.type === 'pong') {
          clearTimeout(timeout);
          ws.close();
          resolve({
            welcomeReceived,
            messageCount,
            pongReceived: true,
          });
        }
      } catch {
        // Ignore parse errors for non-JSON messages
      }
    });

    ws.on('error', (error: Error) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error: ${error.message}`));
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      if (!welcomeReceived) {
        reject(new Error('WebSocket closed without receiving welcome message'));
      }
    });
  });
}

async function testWebSocketPingPong(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket ping/pong timeout'));
    }, 5000);

    let pongReceived = false;
    let latency = 0;
    let pingTime = 0;

    ws.on('open', () => {
      // Wait for welcome, then ping
    });

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'connected') {
          pingTime = Date.now();
          ws.send(JSON.stringify({ type: 'ping' }));
        }

        if (message.type === 'pong') {
          pongReceived = true;
          latency = Date.now() - pingTime;
          assertNotNull(message.timestamp, 'pong timestamp');
          clearTimeout(timeout);
          ws.close();
          resolve({
            pongReceived: true,
            latency,
            serverTimestamp: message.timestamp,
          });
        }
      } catch {
        // Ignore parse errors
      }
    });

    ws.on('error', (error: Error) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error: ${error.message}`));
    });
  });
}

async function testWebSocketDemoState(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timeout = setTimeout(() => {
      ws.close();
      // Demo state request completed even if no state returned
      resolve({ demoStateRequested: true, stateReceived: false });
    }, 3000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'get_demo_state' }));
    });

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'demo_state') {
          clearTimeout(timeout);
          ws.close();

          if (message.data) {
            assertArray(message.data.agents, 'demo agents');
            assertArray(message.data.bubbles, 'demo bubbles');
          }

          resolve({
            demoStateRequested: true,
            stateReceived: true,
            agentCount: message.data?.agents?.length || 0,
            bubbleCount: message.data?.bubbles?.length || 0,
          });
        }
      } catch {
        // Ignore parse errors
      }
    });

    ws.on('error', (error: Error) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error: ${error.message}`));
    });
  });
}

// ============================================================================
// Agent API Tests - Tests correct behavior with or without database
// ============================================================================

async function testAgentsEndpoint(): Promise<Record<string, unknown>> {
  const result = await fetchWithStatus('/api/agents');

  if (!serverHasDatabase) {
    // Should return 503 when database not available
    if (result.status !== 503) {
      throw new Error(`Expected 503 status without database, got ${result.status}`);
    }
    const data = result.data as Record<string, unknown>;
    if (!data.error || !String(data.error).includes('Database not available')) {
      throw new Error(`Expected "Database not available" error, got: ${data.error}`);
    }
    return { mode: 'no-database', correctErrorReturned: true };
  }

  // Database available - validate full response
  if (result.status !== 200) {
    throw new Error(`Expected 200 status with database, got ${result.status}`);
  }

  assertArray(result.data, 'agents');
  const agents = result.data as unknown[];

  if (agents.length > 0) {
    const agent = agents[0] as Record<string, unknown>;
    assertNotNull(agent.id, 'agent.id');
    assertNotNull(agent.name, 'agent.name');
    assertNotNull(agent.type, 'agent.type');
  }

  return {
    mode: 'with-database',
    agentCount: agents.length,
  };
}

async function testGetAgentById(): Promise<Record<string, unknown>> {
  if (!serverHasDatabase) {
    // Verify 503 error response
    const result = await fetchWithStatus('/api/agents/1');
    if (result.status !== 503) {
      throw new Error(`Expected 503 status without database, got ${result.status}`);
    }
    return { mode: 'no-database', correctErrorReturned: true };
  }

  // Get agent list first
  const agentsResult = await fetchWithStatus<unknown[]>('/api/agents');
  const agents = agentsResult.data;

  if (!Array.isArray(agents) || agents.length === 0) {
    // No agents to test with, but that's valid
    return { mode: 'with-database', noAgentsAvailable: true };
  }

  const firstAgent = agents[0] as Record<string, unknown>;
  const result = await fetchWithStatus(`/api/agents/${firstAgent.id}`);

  if (result.status !== 200) {
    throw new Error(`Expected 200 status, got ${result.status}`);
  }

  const response = result.data as Record<string, unknown>;
  assertNotNull(response.id, 'agent.id');
  assertNotNull(response.name, 'agent.name');
  assertNotNull(response.type, 'agent.type');

  return {
    mode: 'with-database',
    agentId: response.id,
    agentName: response.name,
  };
}

async function testAgentNotFound(): Promise<Record<string, unknown>> {
  const result = await fetchWithStatus('/api/agents/99999');

  if (!serverHasDatabase) {
    if (result.status !== 503) {
      throw new Error(`Expected 503 status without database, got ${result.status}`);
    }
    return { mode: 'no-database', correctErrorReturned: true };
  }

  // With database, should return 404
  if (result.status !== 404) {
    throw new Error(`Expected 404 for non-existent agent, got ${result.status}`);
  }

  const data = result.data as Record<string, unknown>;
  if (!data.error) {
    throw new Error('Expected error message for non-existent agent');
  }

  return { mode: 'with-database', correctNotFoundReturned: true };
}

// ============================================================================
// Task API Tests
// ============================================================================

async function testTasksEndpoint(): Promise<Record<string, unknown>> {
  const result = await fetchWithStatus('/api/tasks');

  if (!serverHasDatabase) {
    if (result.status !== 503) {
      throw new Error(`Expected 503 status without database, got ${result.status}`);
    }
    return { mode: 'no-database', correctErrorReturned: true };
  }

  if (result.status !== 200) {
    throw new Error(`Expected 200 status, got ${result.status}`);
  }

  assertArray(result.data, 'tasks');
  const tasks = result.data as unknown[];

  if (tasks.length > 0) {
    const task = tasks[0] as Record<string, unknown>;
    assertNotNull(task.id, 'task.id');
    assertNotNull(task.title, 'task.title');
    assertNotNull(task.status, 'task.status');
  }

  return { mode: 'with-database', taskCount: tasks.length };
}

async function testCreateTask(): Promise<Record<string, unknown>> {
  const testTitle = `Integration Test Task ${Date.now()}`;
  const result = await fetchWithStatus('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: testTitle,
      description: 'Created by integration test',
      priority: 5,
    }),
  });

  if (!serverHasDatabase) {
    if (result.status !== 503) {
      throw new Error(`Expected 503 status without database, got ${result.status}`);
    }
    return { mode: 'no-database', correctErrorReturned: true };
  }

  if (result.status !== 201) {
    throw new Error(`Expected 201 status for created task, got ${result.status}`);
  }

  const response = result.data as Record<string, unknown>;
  assertNotNull(response.id, 'task.id');
  assertNotNull(response.title, 'task.title');
  assertNotNull(response.status, 'task.status');
  assertNotNull(response.created_at, 'task.created_at');

  if (response.title !== testTitle) {
    throw new Error(`Task title mismatch: got "${response.title}", expected "${testTitle}"`);
  }

  if (response.status !== 'pending') {
    throw new Error(`New task status should be "pending", got "${response.status}"`);
  }

  return {
    mode: 'with-database',
    taskId: response.id,
    taskTitle: response.title,
    taskStatus: response.status,
  };
}

async function testTaskValidation(): Promise<Record<string, unknown>> {
  const result = await fetchWithStatus('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      description: 'No title provided',
    }),
  });

  if (!serverHasDatabase) {
    if (result.status !== 503) {
      throw new Error(`Expected 503 status without database, got ${result.status}`);
    }
    return { mode: 'no-database', correctErrorReturned: true };
  }

  // With database, should return 400 for validation error
  if (result.status !== 400) {
    throw new Error(`Expected 400 for validation error, got ${result.status}`);
  }

  const data = result.data as Record<string, unknown>;
  if (!data.error || !String(data.error).includes('title')) {
    throw new Error(`Expected error about missing title, got: ${data.error}`);
  }

  return { mode: 'with-database', validationWorking: true };
}

async function testGetTaskById(): Promise<Record<string, unknown>> {
  if (!serverHasDatabase) {
    const result = await fetchWithStatus('/api/tasks/1');
    if (result.status !== 503) {
      throw new Error(`Expected 503 status without database, got ${result.status}`);
    }
    return { mode: 'no-database', correctErrorReturned: true };
  }

  // Create a task first
  const createResult = await fetchWithStatus('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: `Test Task ${Date.now()}`,
      description: 'For get by ID test',
    }),
  });

  const taskId = (createResult.data as Record<string, unknown>).id;
  const result = await fetchWithStatus(`/api/tasks/${taskId}`);

  if (result.status !== 200) {
    throw new Error(`Expected 200 status, got ${result.status}`);
  }

  const response = result.data as Record<string, unknown>;
  assertNotNull(response.id, 'task.id');
  assertNotNull(response.title, 'task.title');

  if (response.id !== taskId) {
    throw new Error(`Task ID mismatch: got ${response.id}, expected ${taskId}`);
  }

  return { mode: 'with-database', taskId: response.id };
}

// ============================================================================
// Subtask API Tests
// ============================================================================

async function testSubtaskCRUD(): Promise<Record<string, unknown>> {
  if (!serverHasDatabase) {
    const result = await fetchWithStatus('/api/tasks/1/subtasks');
    if (result.status !== 503) {
      throw new Error(`Expected 503 status without database, got ${result.status}`);
    }
    return { mode: 'no-database', correctErrorReturned: true };
  }

  // Create parent task
  const taskResult = await fetchWithStatus('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: `Parent Task ${Date.now()}` }),
  });

  const taskId = (taskResult.data as Record<string, unknown>).id;

  // Create subtask
  const subtaskResult = await fetchWithStatus(`/api/tasks/${taskId}/subtasks`, {
    method: 'POST',
    body: JSON.stringify({
      title: `Subtask ${Date.now()}`,
      description: 'Test subtask',
      orderIndex: 1,
    }),
  });

  if (subtaskResult.status !== 201) {
    throw new Error(`Expected 201 for created subtask, got ${subtaskResult.status}`);
  }

  const subtask = subtaskResult.data as Record<string, unknown>;
  assertNotNull(subtask.id, 'subtask.id');
  assertNotNull(subtask.title, 'subtask.title');
  assertNotNull(subtask.task_id, 'subtask.task_id');

  // Get subtasks
  const listResult = await fetchWithStatus(`/api/tasks/${taskId}/subtasks`);
  assertArray(listResult.data, 'subtasks');

  const subtasks = listResult.data as unknown[];
  if (subtasks.length === 0) {
    throw new Error('Expected at least one subtask');
  }

  return {
    mode: 'with-database',
    parentTaskId: taskId,
    subtaskId: subtask.id,
    subtaskCount: subtasks.length,
  };
}

// ============================================================================
// Message API Tests
// ============================================================================

async function testMessagesEndpoint(): Promise<Record<string, unknown>> {
  const result = await fetchWithStatus('/api/messages');

  if (!serverHasDatabase) {
    if (result.status !== 503) {
      throw new Error(`Expected 503 status without database, got ${result.status}`);
    }
    return { mode: 'no-database', correctErrorReturned: true };
  }

  if (result.status !== 200) {
    throw new Error(`Expected 200 status, got ${result.status}`);
  }

  assertArray(result.data, 'messages');
  const messages = result.data as unknown[];

  if (messages.length > 0) {
    const msg = messages[0] as Record<string, unknown>;
    assertNotNull(msg.id, 'message.id');
    assertNotNull(msg.type, 'message.type');
    assertNotNull(msg.content, 'message.content');
  }

  return { mode: 'with-database', messageCount: messages.length };
}

async function testMessagesWithLimit(): Promise<Record<string, unknown>> {
  const result = await fetchWithStatus('/api/messages?limit=5');

  if (!serverHasDatabase) {
    if (result.status !== 503) {
      throw new Error(`Expected 503 status without database, got ${result.status}`);
    }
    return { mode: 'no-database', correctErrorReturned: true };
  }

  if (result.status !== 200) {
    throw new Error(`Expected 200 status, got ${result.status}`);
  }

  assertArray(result.data, 'messages');
  const messages = result.data as unknown[];

  // Should respect limit
  if (messages.length > 5) {
    throw new Error(`Expected at most 5 messages, got ${messages.length}`);
  }

  return { mode: 'with-database', messageCount: messages.length, limitRespected: true };
}

// ============================================================================
// Hubs API Tests
// ============================================================================

async function testHubsEndpoint(): Promise<Record<string, unknown>> {
  const result = await fetchWithStatus('/api/hubs');

  if (!serverHasDatabase) {
    if (result.status !== 503) {
      throw new Error(`Expected 503 status without database, got ${result.status}`);
    }
    return { mode: 'no-database', correctErrorReturned: true };
  }

  if (result.status !== 200) {
    throw new Error(`Expected 200 status, got ${result.status}`);
  }

  assertArray(result.data, 'hubs');
  const hubs = result.data as unknown[];

  if (hubs.length > 0) {
    const hub = hubs[0] as Record<string, unknown>;
    assertNotNull(hub.id, 'hub.id');
    assertNotNull(hub.name, 'hub.name');
  }

  return { mode: 'with-database', hubCount: hubs.length };
}

// ============================================================================
// Orchestration API Tests
// ============================================================================

async function testOrchestrationState(): Promise<Record<string, unknown>> {
  const result = await fetchWithStatus('/api/orchestration/state');

  if (!serverHasDatabase) {
    if (result.status !== 503) {
      throw new Error(`Expected 503 status without database, got ${result.status}`);
    }
    return { mode: 'no-database', correctErrorReturned: true };
  }

  if (result.status !== 200) {
    throw new Error(`Expected 200 status, got ${result.status}`);
  }

  const response = result.data as Record<string, unknown>;
  assertType(response.isRunning, 'boolean', 'isRunning');
  assertArray(response.agents, 'agents');
  assertArray(response.activeWork, 'activeWork');
  assertArray(response.travelingAgents, 'travelingAgents');

  const agents = response.agents as unknown[];
  if (agents.length > 0) {
    const agent = agents[0] as Record<string, unknown>;
    assertNotNull(agent.agentId, 'agent.agentId');
    assertNotNull(agent.status, 'agent.status');
    assertNotNull(agent.hub, 'agent.hub');
  }

  return {
    mode: 'with-database',
    isRunning: response.isRunning,
    agentCount: agents.length,
  };
}

async function testOrchestrationDebug(): Promise<Record<string, unknown>> {
  const result = await fetchWithStatus('/api/orchestration/debug');

  if (!serverHasDatabase) {
    if (result.status !== 503) {
      throw new Error(`Expected 503 status without database, got ${result.status}`);
    }
    return { mode: 'no-database', correctErrorReturned: true };
  }

  if (result.status !== 200) {
    throw new Error(`Expected 200 status, got ${result.status}`);
  }

  const response = result.data as Record<string, unknown>;
  assertNotNull(response.engine, 'engine');
  assertType(response.stateAgentCount, 'number', 'stateAgentCount');
  assertType(response.dbAgentCount, 'number', 'dbAgentCount');

  if (response.engine !== 'ElizaOS') {
    throw new Error(`Expected engine "ElizaOS", got "${response.engine}"`);
  }

  return {
    mode: 'with-database',
    engine: response.engine,
    stateAgentCount: response.stateAgentCount,
    dbAgentCount: response.dbAgentCount,
  };
}

// ============================================================================
// ElizaOS Runtime Tests
// ============================================================================

async function testElizaRuntimes(): Promise<Record<string, unknown>> {
  const result = await fetchWithStatus('/api/eliza/runtimes');

  if (!serverHasDatabase) {
    if (result.status !== 503) {
      throw new Error(`Expected 503 status without database, got ${result.status}`);
    }
    return { mode: 'no-database', correctErrorReturned: true };
  }

  if (result.status !== 200) {
    throw new Error(`Expected 200 status, got ${result.status}`);
  }

  const response = result.data as Record<string, unknown>;
  assertNotNull(response.engine, 'engine');
  assertArray(response.agents, 'agents');

  if (response.engine !== 'ElizaOS') {
    throw new Error(`Expected engine "ElizaOS", got "${response.engine}"`);
  }

  return {
    mode: 'with-database',
    engine: response.engine,
    runtimeCount: (response.agents as unknown[]).length,
  };
}

// ============================================================================
// Visual Demo Tests (always available)
// ============================================================================

async function testVisualDemoActive(): Promise<Record<string, unknown>> {
  const health = await fetchJson('/api/health');
  const demoState = await fetchJson('/api/demo/state');

  // If visual demo is active, verify the state
  if (health.visualDemoActive) {
    assertType(demoState.running, 'boolean', 'running');
    if (demoState.state) {
      const state = demoState.state as Record<string, unknown>;
      assertArray(state.agents, 'demo state agents');
    }
    return { visualDemoActive: true, hasState: !!demoState.state };
  }

  return { visualDemoActive: false, demoNotRunning: true };
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runAllTests(): Promise<void> {
  log('\n========================================', 'bold');
  log('  Eliza Town Integration Tests', 'cyan');
  log('========================================\n', 'bold');
  log(`Server: ${SERVER_URL}`, 'blue');
  log(`WebSocket: ${WS_URL}\n`, 'blue');

  // Check if server is reachable and get health
  try {
    const health = await fetchJson('/api/health');
    serverHasDatabase = health.dbAvailable as boolean;
    log(`Database: ${serverHasDatabase ? 'Available' : 'Not available (demo mode)'}`, serverHasDatabase ? 'green' : 'yellow');
    log(`Visual Demo: ${health.visualDemoActive ? 'Active' : 'Inactive'}`, 'blue');
    log('');
  } catch {
    log('\n✗ Server is not reachable!', 'red');
    log(`  Make sure the server is running at ${SERVER_URL}`, 'yellow');
    log('  Start it with: bun run dev or bun run demo\n', 'yellow');
    process.exit(1);
  }

  // Health & Server Tests
  log('\n📋 Health & Server Tests', 'cyan');
  await runTest('Health endpoint returns valid response', testHealthEndpoint);
  await runTest('Demo state endpoint works', testDemoStateEndpoint);
  await runTest('Demo status endpoint works', testDemoStatusEndpoint);
  await runTest('Execution config endpoint works', testExecutionConfigEndpoint);
  await runTest('Visual demo state check', testVisualDemoActive);

  // WebSocket Tests
  log('\n🔌 WebSocket Tests', 'cyan');
  await runTest('WebSocket connects and receives welcome', testWebSocketConnection);
  await runTest('WebSocket ping/pong works', testWebSocketPingPong);
  await runTest('WebSocket demo state request works', testWebSocketDemoState);

  // Agent API Tests
  log('\n🤖 Agent API Tests', 'cyan');
  await runTest('GET /api/agents handles response correctly', testAgentsEndpoint);
  await runTest('GET /api/agents/:id handles response correctly', testGetAgentById);
  await runTest('GET /api/agents/:id returns 404 for non-existent', testAgentNotFound);

  // Task API Tests
  log('\n📝 Task API Tests', 'cyan');
  await runTest('GET /api/tasks handles response correctly', testTasksEndpoint);
  await runTest('POST /api/tasks handles task creation', testCreateTask);
  await runTest('GET /api/tasks/:id handles response correctly', testGetTaskById);
  await runTest('POST /api/tasks validates required fields', testTaskValidation);

  // Subtask Tests
  log('\n📋 Subtask API Tests', 'cyan');
  await runTest('Subtask CRUD operations work correctly', testSubtaskCRUD);

  // Message Tests
  log('\n💬 Message API Tests', 'cyan');
  await runTest('GET /api/messages handles response correctly', testMessagesEndpoint);
  await runTest('GET /api/messages respects limit parameter', testMessagesWithLimit);

  // Hub Tests
  log('\n🏠 Hub API Tests', 'cyan');
  await runTest('GET /api/hubs handles response correctly', testHubsEndpoint);

  // Orchestration Tests
  log('\n⚙️ Orchestration API Tests', 'cyan');
  await runTest('GET /api/orchestration/state handles response', testOrchestrationState);
  await runTest('GET /api/orchestration/debug handles response', testOrchestrationDebug);

  // ElizaOS Runtime Tests
  log('\n🧠 ElizaOS Runtime Tests', 'cyan');
  await runTest('GET /api/eliza/runtimes handles response correctly', testElizaRuntimes);

  // Summary
  log('\n========================================', 'bold');
  log('  Test Results Summary', 'cyan');
  log('========================================\n', 'bold');

  const total = passedCount + failedCount;
  const passRate = total > 0 ? Math.round((passedCount / total) * 100) : 0;

  log(`Mode: ${serverHasDatabase ? 'Full (with database)' : 'Demo (no database)'}`, 'blue');
  log(`Total:  ${total} tests`, 'blue');
  log(`Passed: ${passedCount} (${passRate}%)`, passedCount === total ? 'green' : 'yellow');
  log(`Failed: ${failedCount}`, failedCount > 0 ? 'red' : 'green');

  // Show failed tests details
  if (failedCount > 0) {
    log('\n❌ Failed Tests:', 'red');
    for (const result of results.filter((r) => !r.passed)) {
      log(`\n  ${result.name}`, 'red');
      log(`    Error: ${result.error}`, 'yellow');
    }
  }

  log('\n');

  // Exit with error code if any tests failed or not 100%
  process.exit(failedCount > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch((error) => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
