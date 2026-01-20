-- Eliza Town Agent Orchestration Database Schema

-- Hubs represent locations in the town where agents work
CREATE TABLE IF NOT EXISTS hubs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    type VARCHAR(50) NOT NULL, -- 'planning', 'design', 'coding', 'review', 'general'
    position_x FLOAT NOT NULL DEFAULT 0,
    position_z FLOAT NOT NULL DEFAULT 0,
    capacity INTEGER NOT NULL DEFAULT 4,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Agents are the AI workers in the town
CREATE TABLE IF NOT EXISTS agents (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'planner', 'designer', 'coder', 'reviewer'
    model_id VARCHAR(50) NOT NULL, -- references character model from manifest
    current_hub_id INTEGER REFERENCES hubs(id),
    status VARCHAR(30) DEFAULT 'idle', -- 'idle', 'working', 'traveling', 'chatting'
    position_x FLOAT DEFAULT 0,
    position_z FLOAT DEFAULT 0,
    personality TEXT,
    capabilities TEXT[], -- array of skills
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tasks are high-level work items
CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(30) DEFAULT 'pending', -- 'pending', 'in_progress', 'review', 'completed', 'failed'
    priority INTEGER DEFAULT 5, -- 1 (highest) to 10 (lowest)
    assigned_agent_id INTEGER REFERENCES agents(id),
    parent_task_id INTEGER REFERENCES tasks(id),
    session_id VARCHAR(64), -- per-user browser session isolation
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Subtasks break down tasks into smaller work units
CREATE TABLE IF NOT EXISTS subtasks (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(30) DEFAULT 'pending',
    assigned_agent_id INTEGER REFERENCES agents(id),
    order_index INTEGER DEFAULT 0,
    output TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Messages represent agent communications and thoughts
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    task_id INTEGER REFERENCES tasks(id),
    subtask_id INTEGER REFERENCES subtasks(id),
    type VARCHAR(30) NOT NULL, -- 'thought', 'chat', 'announcement', 'status'
    content TEXT NOT NULL,
    target_agent_id INTEGER REFERENCES agents(id),
    hub_id INTEGER REFERENCES hubs(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Agent work sessions track time spent on tasks
CREATE TABLE IF NOT EXISTS work_sessions (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    task_id INTEGER REFERENCES tasks(id),
    subtask_id INTEGER REFERENCES subtasks(id),
    hub_id INTEGER REFERENCES hubs(id),
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    notes TEXT
);

-- Claude API call logs for debugging and cost tracking
CREATE TABLE IF NOT EXISTS api_calls (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER REFERENCES agents(id),
    task_id INTEGER REFERENCES tasks(id),
    model VARCHAR(50) NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    prompt_summary TEXT,
    response_summary TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default hubs matching the town layout
INSERT INTO hubs (name, type, position_x, position_z) VALUES
    ('Town Hall', 'planning', 0, 0),
    ('Design Studio', 'design', -15, -15),
    ('Code Forge', 'coding', 15, -15),
    ('Review Tower', 'review', 0, -30),
    ('Market Square', 'general', 0, 15),
    ('Tavern', 'general', -15, 15),
    ('Library', 'general', 15, 15)
ON CONFLICT (name) DO NOTHING;

-- Add session_id column if it doesn't exist (for existing databases)
-- MUST run BEFORE creating index on session_id
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS session_id VARCHAR(64);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_hub ON agents(current_hub_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id);
CREATE INDEX IF NOT EXISTS idx_messages_task ON messages(task_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
