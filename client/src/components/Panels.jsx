import { useState } from 'react'
import { useGameStore } from '../stores/gameStore'
import { createTask, downloadTaskFile } from '../services/api'
import styles from '../styles/Panels.module.css'

// Agent type colors
const TYPE_COLORS = {
  planner: '#c084fc',
  designer: '#f472b6',
  coder: '#60a5fa',
  reviewer: '#4ade80',
}

/**
 * Panel wrapper with collapsible header
 */
function Panel({ title, badge, status, children, className = '' }) {
  const [collapsed, setCollapsed] = useState(false)
  
  return (
    <div className={`${styles.panel} ${collapsed ? styles.collapsed : ''} ${className}`}>
      <div className={styles.panelHeader} onClick={() => setCollapsed(!collapsed)}>
        <span>{title}</span>
        {badge && <span className={styles.badge}>{badge}</span>}
        {status && (
          <span className={`${styles.status} ${status === 'connected' ? styles.connected : styles.disconnected}`}>
            {status === 'connected' ? 'Online' : 'Offline'}
          </span>
        )}
      </div>
      {!collapsed && <div className={styles.panelContent}>{children}</div>}
    </div>
  )
}

/**
 * Agents panel - shows all ElizaOS agents
 */
export function AgentsPanel({ onSelectAgent }) {
  const agents = useGameStore((s) => s.agents)
  const connected = useGameStore((s) => s.connected)
  
  return (
    <Panel title="Agents" status={connected ? 'connected' : 'disconnected'}>
      {agents.length === 0 ? (
        <div className={styles.placeholder}>Connecting to server...</div>
      ) : (
        <div className={styles.agentList}>
          {agents.map((agent) => (
            <div 
              key={agent.id} 
              className={styles.agentCard}
              onClick={() => onSelectAgent(agent)}
            >
              <div 
                className={styles.agentAvatar}
                style={{ background: `linear-gradient(135deg, ${TYPE_COLORS[agent.type] || '#667eea'}, #4a5568)` }}
              >
                {agent.name?.charAt(0) || '?'}
              </div>
              <div className={styles.agentInfo}>
                <div className={styles.agentName}>{agent.name}</div>
                <div className={styles.agentRole}>{agent.type}</div>
              </div>
              <div className={`${styles.agentStatus} ${styles[agent.status || 'idle']}`}>
                {agent.status || 'idle'}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

/**
 * Tasks panel - shows active tasks
 */
export function TasksPanel() {
  const tasks = useGameStore((s) => s.tasks)
  const activeTasks = tasks.filter((t) => t.status !== 'completed').slice(0, 5)
  
  return (
    <Panel title="Active Tasks" badge={activeTasks.length}>
      {activeTasks.length === 0 ? (
        <div className={styles.placeholder}>No active tasks</div>
      ) : (
        <div className={styles.taskList}>
          {activeTasks.map((task) => (
            <div key={task.id} className={`${styles.taskItem} ${styles[task.status]}`}>
              <div className={styles.taskTitle}>{task.title}</div>
              <div className={styles.taskMeta}>
                Priority: {task.priority} | Status: {task.status}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

/**
 * Results panel - shows completed task results with files
 */
export function ResultsPanel() {
  const results = useGameStore((s) => s.results)
  const taskFiles = useGameStore((s) => s.taskFiles)
  
  return (
    <Panel title="Results" badge={results.length}>
      {results.length === 0 ? (
        <div className={styles.placeholder}>Completed task results will appear here</div>
      ) : (
        <div className={styles.resultsList}>
          {results.map((result, idx) => {
            const files = taskFiles.get(result.taskId) || []
            return (
              <div key={idx} className={styles.resultItem}>
                <div className={styles.resultHeader}>
                  <span className={styles.resultTitle}>Task #{result.taskId}</span>
                  <span className={styles.resultStatus}>Completed</span>
                </div>
                {files.length > 0 && (
                  <div className={styles.resultFiles}>
                    {files.map((file, fidx) => (
                      <div 
                        key={fidx} 
                        className={styles.resultFile}
                        onClick={() => downloadTaskFile(result.taskId, file.filename)}
                      >
                        📄 {file.filename}
                      </div>
                    ))}
                  </div>
                )}
                <div className={styles.resultTime}>
                  {result.completedAt?.toLocaleTimeString()}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

/**
 * Messages panel - shows activity feed
 */
export function MessagesPanel() {
  const messages = useGameStore((s) => s.messages)
  const recentMessages = messages.slice(0, 15)
  
  return (
    <Panel title="Activity Feed" className={styles.messagesPanel}>
      {recentMessages.length === 0 ? (
        <div className={styles.placeholder}>Waiting for activity...</div>
      ) : (
        <div className={styles.messagesList}>
          {recentMessages.map((msg, idx) => (
            <div key={idx} className={styles.messageItem}>
              <div className={styles.messageHeader}>
                <span className={styles.messageAgent}>{msg.agent_name || 'Agent'}</span>
                <span className={styles.messageTime}>
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className={styles.messageContent}>
                <span className={`${styles.messageType} ${styles[msg.type]}`}>{msg.type}</span>
                {msg.content}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

/**
 * Task input - create new tasks
 */
export function TaskInput() {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState(5)
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState(null) // 'success' | 'error' | null
  const connected = useGameStore((s) => s.connected)
  
  const handleSubmit = async () => {
    if (!title.trim() || submitting) return
    
    setSubmitting(true)
    setStatus(null)
    
    try {
      await createTask(title, '', priority)
      setTitle('')
      setStatus('success')
      setTimeout(() => setStatus(null), 2000)
    } catch (error) {
      console.error('Failed to create task:', error)
      setStatus('error')
      setTimeout(() => setStatus(null), 2000)
    } finally {
      setSubmitting(false)
    }
  }
  
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && connected) {
      e.preventDefault()
      handleSubmit()
    }
  }
  
  return (
    <div className={styles.taskInputContainer}>
      <div className={styles.inputHeader}>
        <label>Assign a Task</label>
        <span className={styles.charCount}>{title.length}/500</span>
      </div>
      <textarea
        className={styles.taskInput}
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 500))}
        onKeyDown={handleKeyDown}
        placeholder="Describe what you want the agents to work on..."
        rows={3}
      />
      <div className={styles.buttonRow}>
        <select 
          className={styles.prioritySelect}
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
        >
          <option value={3}>High Priority</option>
          <option value={5}>Normal</option>
          <option value={7}>Low Priority</option>
        </select>
        <button
          className={`${styles.submitButton} ${status ? styles[status] : ''}`}
          onClick={handleSubmit}
          disabled={!title.trim() || submitting || !connected}
        >
          {submitting ? 'Submitting...' : status === 'success' ? 'Task Created!' : status === 'error' ? 'Failed - Try Again' : 'Submit Task'}
        </button>
      </div>
      <div className={styles.serverStatus}>
        <span className={`${styles.dot} ${connected ? styles.online : ''}`} />
        <span>{connected ? 'Server online - agents ready' : 'Server offline - reconnecting...'}</span>
      </div>
    </div>
  )
}
