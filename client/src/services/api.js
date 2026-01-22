/**
 * API service for ElizaOS backend
 */

const API_BASE = '/api'

// Session ID for per-user task isolation
function getSessionId() {
  let sessionId = localStorage.getItem('eliza-session-id')
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    localStorage.setItem('eliza-session-id', sessionId)
  }
  return sessionId
}

const SESSION_ID = getSessionId()

/**
 * Check server health
 */
export async function checkHealth() {
  const response = await fetch(`${API_BASE}/health`)
  if (!response.ok) throw new Error('Server offline')
  return response.json()
}

/**
 * Get all agents
 */
export async function getAgents() {
  const response = await fetch(`${API_BASE}/agents`)
  if (!response.ok) throw new Error('Failed to fetch agents')
  return response.json()
}

/**
 * Get agent by ID
 */
export async function getAgent(id) {
  const response = await fetch(`${API_BASE}/agents/${id}`)
  if (!response.ok) throw new Error('Agent not found')
  return response.json()
}

/**
 * Update agent
 */
export async function updateAgent(id, updates) {
  const response = await fetch(`${API_BASE}/agents/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!response.ok) throw new Error('Failed to update agent')
  return response.json()
}

/**
 * Trigger agent decision
 */
export async function triggerAgentDecision(id, prompt) {
  const response = await fetch(`${API_BASE}/agents/${id}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  if (!response.ok) throw new Error('Failed to trigger decision')
  return response.json()
}

/**
 * Get tasks
 */
export async function getTasks(status = null) {
  const url = status 
    ? `${API_BASE}/tasks?status=${status}` 
    : `${API_BASE}/tasks`
  const response = await fetch(url, {
    headers: { 'X-Session-Id': SESSION_ID },
  })
  if (!response.ok) throw new Error('Failed to fetch tasks')
  return response.json()
}

/**
 * Create task
 */
export async function createTask(title, description = '', priority = 5) {
  const response = await fetch(`${API_BASE}/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': SESSION_ID,
    },
    body: JSON.stringify({ title, description, priority }),
  })
  if (!response.ok) throw new Error('Failed to create task')
  return response.json()
}

/**
 * Get task files
 */
export async function getTaskFiles(taskId) {
  const response = await fetch(`${API_BASE}/tasks/${taskId}/files`)
  if (!response.ok) throw new Error('Failed to fetch files')
  return response.json()
}

/**
 * Download task file
 */
export async function downloadTaskFile(taskId, filename) {
  const response = await fetch(`${API_BASE}/tasks/${taskId}/files/${filename}`)
  if (!response.ok) throw new Error('File not found')
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Get ElizaOS runtime info
 */
export async function getElizaRuntimes() {
  const response = await fetch(`${API_BASE}/eliza/runtimes`)
  if (!response.ok) throw new Error('Failed to fetch runtimes')
  return response.json()
}

/**
 * Get orchestration state
 */
export async function getOrchestrationState() {
  const response = await fetch(`${API_BASE}/orchestration/state`)
  if (!response.ok) throw new Error('Failed to fetch state')
  return response.json()
}

/**
 * Start orchestration
 */
export async function startOrchestration(interval = 5000) {
  const response = await fetch(`${API_BASE}/orchestration/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interval }),
  })
  if (!response.ok) throw new Error('Failed to start')
  return response.json()
}

/**
 * Stop orchestration
 */
export async function stopOrchestration() {
  const response = await fetch(`${API_BASE}/orchestration/stop`, {
    method: 'POST',
  })
  if (!response.ok) throw new Error('Failed to stop')
  return response.json()
}
