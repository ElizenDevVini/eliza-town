import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { Pool } = pg;

// Type definitions
export interface Agent {
  id: number;
  name: string;
  type: string;
  model_id: string;
  personality: string;
  capabilities: string;
  status: string;
  current_hub_id: string | null;
  position_x: number | null;
  position_z: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface Hub {
  id: string;
  name: string;
  description: string;
  type: string;
  position_x: number;
  position_y: number;
}

export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: string;
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
  status: string;
  order_index: number;
  output: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

export interface Message {
  id: number;
  agent_id: number;
  type: string;
  content: string;
  task_id: number | null;
  subtask_id: number | null;
  target_agent_id: number | null;
  hub_id: string | null;
  created_at: Date;
  agent_name?: string;
  agent_type?: string;
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

export interface AgentUpdateFields {
  name?: string;
  type?: string;
  model_id?: string;
  personality?: string;
  capabilities?: string;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

export async function initializeDatabase(): Promise<void> {
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');

  // First, ensure the tasks table has session_id column (for existing databases)
  // This must run BEFORE the schema which creates an index on session_id
  try {
    // Check if tasks table exists first
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'tasks'
      )
    `);

    if (tableCheck.rows[0].exists) {
      await pool.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS session_id VARCHAR(64)');
      console.log('Migration: session_id column ensured on existing tasks table');
    }
  } catch (migrationError) {
    const error = migrationError as Error;
    console.log('Migration note:', error.message);
  }

  // Now run the full schema
  try {
    await pool.query(schema);
    console.log('Database schema initialized');
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }
}

interface QueryResult<T> {
  rows: T[];
  rowCount: number | null;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: (string | number | null | undefined)[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  const result = await pool.query<T>(text, params);
  const duration = Date.now() - start;
  console.log('Executed query', { text: text.substring(0, 50), duration, rows: result.rowCount });
  return result;
}

// Agent queries
export async function getAgents(): Promise<Agent[]> {
  const result = await query<Agent>('SELECT * FROM agents ORDER BY id');
  return result.rows;
}

export async function getAgent(id: number): Promise<Agent | undefined> {
  const result = await query<Agent>('SELECT * FROM agents WHERE id = $1', [id]);
  return result.rows[0];
}

export async function updateAgentStatus(
  id: number,
  status: string,
  hubId: string | null = null,
  positionX: number | null = null,
  positionZ: number | null = null
): Promise<Agent | undefined> {
  const updates = ['status = $2', 'updated_at = CURRENT_TIMESTAMP'];
  const params: (number | string | null)[] = [id, status];
  let paramIndex = 3;

  if (hubId !== null) {
    updates.push(`current_hub_id = $${paramIndex++}`);
    params.push(hubId);
  }
  if (positionX !== null) {
    updates.push(`position_x = $${paramIndex++}`);
    params.push(positionX);
  }
  if (positionZ !== null) {
    updates.push(`position_z = $${paramIndex++}`);
    params.push(positionZ);
  }

  const result = await query<Agent>(
    `UPDATE agents SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return result.rows[0];
}

export async function createAgent(
  name: string,
  type: string,
  modelId: string,
  personality: string,
  capabilities: string
): Promise<Agent> {
  const result = await query<Agent>(
    `INSERT INTO agents (name, type, model_id, personality, capabilities)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, type, modelId, personality, capabilities]
  );
  return result.rows[0];
}

export async function updateAgent(id: number, updates: AgentUpdateFields): Promise<Agent | undefined> {
  const fields: string[] = [];
  const params: (number | string)[] = [id];
  let paramIndex = 2;

  if (updates.name !== undefined) {
    fields.push(`name = $${paramIndex++}`);
    params.push(updates.name);
  }
  if (updates.type !== undefined) {
    fields.push(`type = $${paramIndex++}`);
    params.push(updates.type);
  }
  if (updates.model_id !== undefined) {
    fields.push(`model_id = $${paramIndex++}`);
    params.push(updates.model_id);
  }
  if (updates.personality !== undefined) {
    fields.push(`personality = $${paramIndex++}`);
    params.push(updates.personality);
  }
  if (updates.capabilities !== undefined) {
    fields.push(`capabilities = $${paramIndex++}`);
    params.push(updates.capabilities);
  }

  if (fields.length === 0) {
    return getAgent(id);
  }

  fields.push('updated_at = CURRENT_TIMESTAMP');

  const result = await query<Agent>(
    `UPDATE agents SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return result.rows[0];
}

// Hub queries
export async function getHubs(): Promise<Hub[]> {
  const result = await query<Hub>('SELECT * FROM hubs ORDER BY id');
  return result.rows;
}

export async function getHub(id: number): Promise<Hub | undefined> {
  const result = await query<Hub>('SELECT * FROM hubs WHERE id = $1', [id]);
  return result.rows[0];
}

export async function getHubByName(name: string): Promise<Hub | undefined> {
  const result = await query<Hub>('SELECT * FROM hubs WHERE name = $1', [name]);
  return result.rows[0];
}

// Task queries
export async function getTasks(status: string | null = null, sessionId: string | null = null): Promise<Task[]> {
  const conditions: string[] = [];
  const params: string[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(status);
  }
  if (sessionId) {
    conditions.push(`session_id = $${paramIndex++}`);
    params.push(sessionId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query<Task>(`SELECT * FROM tasks ${whereClause} ORDER BY priority, created_at`, params);
  return result.rows;
}

export async function getTask(id: number): Promise<Task | undefined> {
  const result = await query<Task>('SELECT * FROM tasks WHERE id = $1', [id]);
  return result.rows[0];
}

export async function createTask(
  title: string,
  description: string | null,
  priority = 5,
  sessionId: string | null = null
): Promise<Task> {
  const result = await query<Task>(
    `INSERT INTO tasks (title, description, priority, session_id) VALUES ($1, $2, $3, $4) RETURNING *`,
    [title, description, priority, sessionId]
  );
  return result.rows[0];
}

export async function updateTaskStatus(
  id: number,
  status: string,
  assignedAgentId: number | null = null
): Promise<Task | undefined> {
  const updates = ['status = $2', 'updated_at = CURRENT_TIMESTAMP'];
  const params: (number | string | null)[] = [id, status];

  if (assignedAgentId !== null) {
    updates.push('assigned_agent_id = $3');
    params.push(assignedAgentId);
  }

  if (status === 'completed') {
    updates.push('completed_at = CURRENT_TIMESTAMP');
  }

  const result = await query<Task>(
    `UPDATE tasks SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return result.rows[0];
}

// Subtask queries
export async function getSubtasks(taskId: number): Promise<Subtask[]> {
  const result = await query<Subtask>(
    'SELECT * FROM subtasks WHERE task_id = $1 ORDER BY order_index',
    [taskId]
  );
  return result.rows;
}

export async function createSubtask(
  taskId: number,
  title: string,
  description: string | null,
  orderIndex: number
): Promise<Subtask> {
  const result = await query<Subtask>(
    `INSERT INTO subtasks (task_id, title, description, order_index)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [taskId, title, description, orderIndex]
  );
  return result.rows[0];
}

export async function updateSubtaskStatus(
  id: number,
  status: string,
  output: string | null = null
): Promise<Subtask | undefined> {
  const updates = ['status = $2', 'updated_at = CURRENT_TIMESTAMP'];
  const params: (number | string | null)[] = [id, status];

  if (output !== null) {
    updates.push('output = $3');
    params.push(output);
  }

  if (status === 'completed') {
    updates.push('completed_at = CURRENT_TIMESTAMP');
  }

  const result = await query<Subtask>(
    `UPDATE subtasks SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return result.rows[0];
}

// Message queries
export async function createMessage(
  agentId: number,
  type: string,
  content: string,
  taskId: number | null = null,
  subtaskId: number | null = null,
  targetAgentId: number | null = null,
  hubId: string | null = null
): Promise<Message> {
  const result = await query<Message>(
    `INSERT INTO messages (agent_id, type, content, task_id, subtask_id, target_agent_id, hub_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [agentId, type, content, taskId, subtaskId, targetAgentId, hubId]
  );
  return result.rows[0];
}

export async function getRecentMessages(limit = 50): Promise<Message[]> {
  const result = await query<Message>(
    `SELECT m.*, a.name as agent_name, a.type as agent_type
     FROM messages m
     JOIN agents a ON m.agent_id = a.id
     ORDER BY m.created_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

// API call logging
export async function logApiCall(
  agentId: number,
  taskId: number | null,
  model: string,
  inputTokens: number,
  outputTokens: number,
  promptSummary: string,
  responseSummary: string,
  durationMs: number
): Promise<ApiCall> {
  const result = await query<ApiCall>(
    `INSERT INTO api_calls (agent_id, task_id, model, input_tokens, output_tokens, prompt_summary, response_summary, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [agentId, taskId, model, inputTokens, outputTokens, promptSummary, responseSummary, durationMs]
  );
  return result.rows[0];
}

export default pool;
