import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

export async function initializeDatabase() {
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');

  try {
    await pool.query(schema);
    console.log('Database schema initialized');
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }

  // Run migrations separately to ensure they succeed even if main schema has issues
  try {
    await pool.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS session_id VARCHAR(64)');
    console.log('Migration: session_id column ensured');
  } catch (migrationError) {
    console.log('Migration note:', migrationError.message);
  }
}

export async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  console.log('Executed query', { text: text.substring(0, 50), duration, rows: result.rowCount });
  return result;
}

// Agent queries
export async function getAgents() {
  const result = await query('SELECT * FROM agents ORDER BY id');
  return result.rows;
}

export async function getAgent(id) {
  const result = await query('SELECT * FROM agents WHERE id = $1', [id]);
  return result.rows[0];
}

export async function updateAgentStatus(id, status, hubId = null, positionX = null, positionZ = null) {
  const updates = ['status = $2', 'updated_at = CURRENT_TIMESTAMP'];
  const params = [id, status];
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

  const result = await query(
    `UPDATE agents SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return result.rows[0];
}

export async function createAgent(name, type, modelId, personality, capabilities) {
  const result = await query(
    `INSERT INTO agents (name, type, model_id, personality, capabilities)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, type, modelId, personality, capabilities]
  );
  return result.rows[0];
}

// Hub queries
export async function getHubs() {
  const result = await query('SELECT * FROM hubs ORDER BY id');
  return result.rows;
}

export async function getHub(id) {
  const result = await query('SELECT * FROM hubs WHERE id = $1', [id]);
  return result.rows[0];
}

export async function getHubByName(name) {
  const result = await query('SELECT * FROM hubs WHERE name = $1', [name]);
  return result.rows[0];
}

// Task queries
export async function getTasks(status = null, sessionId = null) {
  const conditions = [];
  const params = [];
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
  const result = await query(`SELECT * FROM tasks ${whereClause} ORDER BY priority, created_at`, params);
  return result.rows;
}

export async function getTask(id) {
  const result = await query('SELECT * FROM tasks WHERE id = $1', [id]);
  return result.rows[0];
}

export async function createTask(title, description, priority = 5, sessionId = null) {
  const result = await query(
    `INSERT INTO tasks (title, description, priority, session_id) VALUES ($1, $2, $3, $4) RETURNING *`,
    [title, description, priority, sessionId]
  );
  return result.rows[0];
}

export async function updateTaskStatus(id, status, assignedAgentId = null) {
  const updates = ['status = $2', 'updated_at = CURRENT_TIMESTAMP'];
  const params = [id, status];

  if (assignedAgentId !== null) {
    updates.push('assigned_agent_id = $3');
    params.push(assignedAgentId);
  }

  if (status === 'completed') {
    updates.push('completed_at = CURRENT_TIMESTAMP');
  }

  const result = await query(
    `UPDATE tasks SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return result.rows[0];
}

// Subtask queries
export async function getSubtasks(taskId) {
  const result = await query(
    'SELECT * FROM subtasks WHERE task_id = $1 ORDER BY order_index',
    [taskId]
  );
  return result.rows;
}

export async function createSubtask(taskId, title, description, orderIndex) {
  const result = await query(
    `INSERT INTO subtasks (task_id, title, description, order_index)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [taskId, title, description, orderIndex]
  );
  return result.rows[0];
}

export async function updateSubtaskStatus(id, status, output = null) {
  const updates = ['status = $2', 'updated_at = CURRENT_TIMESTAMP'];
  const params = [id, status];

  if (output !== null) {
    updates.push('output = $3');
    params.push(output);
  }

  if (status === 'completed') {
    updates.push('completed_at = CURRENT_TIMESTAMP');
  }

  const result = await query(
    `UPDATE subtasks SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return result.rows[0];
}

// Message queries
export async function createMessage(agentId, type, content, taskId = null, subtaskId = null, targetAgentId = null, hubId = null) {
  const result = await query(
    `INSERT INTO messages (agent_id, type, content, task_id, subtask_id, target_agent_id, hub_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [agentId, type, content, taskId, subtaskId, targetAgentId, hubId]
  );
  return result.rows[0];
}

export async function getRecentMessages(limit = 50) {
  const result = await query(
    `SELECT m.*, a.name as agent_name, a.type as agent_type
     FROM messages m
     JOIN agents a ON m.agent_id = a.id
     ORDER BY m.created_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

// API call logging
export async function logApiCall(agentId, taskId, model, inputTokens, outputTokens, promptSummary, responseSummary, durationMs) {
  const result = await query(
    `INSERT INTO api_calls (agent_id, task_id, model, input_tokens, output_tokens, prompt_summary, response_summary, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [agentId, taskId, model, inputTokens, outputTokens, promptSummary, responseSummary, durationMs]
  );
  return result.rows[0];
}

export default pool;
