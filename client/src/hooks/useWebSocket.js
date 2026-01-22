import { useEffect, useRef, useCallback } from 'react'
import { useGameStore, useBubbleStore, normalizeAgentId } from '../stores/gameStore'
import { handleDemoState, handleAgentBubble } from './useDemoMode'

/**
 * WebSocket hook for real-time ElizaOS backend connection
 */
export function useWebSocket() {
  const wsRef = useRef(null)
  const reconnectTimeoutRef = useRef(null)
  const retryCountRef = useRef(0)
  const isConnectingRef = useRef(false)
  
  const setConnected = useGameStore((s) => s.setConnected)
  const setAgents = useGameStore((s) => s.setAgents)
  const setTasks = useGameStore((s) => s.setTasks)
  const setMessages = useGameStore((s) => s.setMessages)
  const addMessage = useGameStore((s) => s.addMessage)
  const addResult = useGameStore((s) => s.addResult)
  const addTaskFile = useGameStore((s) => s.addTaskFile)
  const startAgentMove = useGameStore((s) => s.startAgentMove)
  const showBubble = useBubbleStore((s) => s.showBubble)
  const setDemoMode = useGameStore((s) => s.setDemoMode)

  const handleMessage = useCallback((event) => {
    try {
      const message = JSON.parse(event.data)
      
      switch (message.type) {
        case 'connected':
          console.log('[WS] Connected:', message.data?.message)
          break

        case 'state_update':
          // Full state update from server
          if (message.data.agents) {
            setAgents(message.data.agents)
          }
          if (message.data.tasks) {
            setTasks(message.data.tasks)
          }
          if (message.data.messages) {
            setMessages(message.data.messages)
          }
          break

        case 'agent_speak':
        case 'agent_think': {
          const { agentId, agent, text, type } = message.data
          const id = normalizeAgentId(agentId || agent)
          const bubbleType = message.type === 'agent_think' ? 'thought' : type || 'saying'
          const duration = Math.max(3000, (text?.length || 0) * 50)
          showBubble(id, text, bubbleType, duration)
          
          // Also add to messages feed
          addMessage({
            agent_name: message.data.agentName || message.data.agent || id,
            type: bubbleType,
            content: text,
            created_at: new Date().toISOString(),
          })
          break
        }

        case 'agent_status': {
          const { agentId, agent, doing, status, hub } = message.data
          const id = normalizeAgentId(agentId || agent)
          
          if (doing) {
            showBubble(id, doing, 'status', 3000)
          }
          
          // Update agent in local state - use functional update to avoid stale state
          setAgents((prevAgents) => {
            return prevAgents.map(a => {
              const aId = normalizeAgentId(a.id)
              if (aId === id) {
                return { 
                  ...a, 
                  status: status || a.status,
                  current_hub: hub || a.current_hub,
                  doing: doing || ''
                }
              }
              return a
            })
          })
          break
        }

        case 'agent_move': {
          const { agentId, agent, hub, to } = message.data
          const id = normalizeAgentId(agentId || agent)
          
          // Determine target hub
          const targetHub = hub || to
          
          if (targetHub) {
            // Use the store's movement system for smooth interpolation
            startAgentMove(id, targetHub)
            
            // Also update the agent's current_hub in agent data
            setAgents((prevAgents) => {
              return prevAgents.map(a => {
                const aId = normalizeAgentId(a.id)
                if (aId === id) {
                  return { ...a, status: 'traveling', current_hub: targetHub }
                }
                return a
              })
            })
          }
          break
        }

        case 'agent_arrived': {
          const { agentId, agent, hub } = message.data
          const id = normalizeAgentId(agentId || agent)
          
          // Update agent status to idle when arrived
          setAgents((prevAgents) => {
            return prevAgents.map(a => {
              const aId = normalizeAgentId(a.id)
              if (aId === id) {
                return { ...a, status: 'idle', current_hub: hub || a.current_hub }
              }
              return a
            })
          })
          break
        }

        case 'file_created':
        case 'agent_code_written': {
          const { taskId, filename, size, filepath } = message.data
          addTaskFile(taskId, { filename, size, filepath })
          console.log('[WS] File created:', filename)
          
          // Add to messages
          addMessage({
            agent_name: message.data.agent || 'Coder',
            type: 'code',
            content: `Created ${filename}`,
            created_at: new Date().toISOString(),
          })
          break
        }

        case 'task_created': {
          const { task } = message.data
          const currentTasks = useGameStore.getState().tasks
          setTasks([task, ...currentTasks])
          break
        }

        case 'task_complete':
        case 'task_completed': {
          const { taskId, task, result } = message.data
          addResult({
            taskId: taskId || task?.id,
            completedAt: new Date(),
            result,
          })
          console.log('[WS] Task complete:', taskId || task?.id)
          break
        }

        case 'task_update': {
          const { task } = message.data
          const currentTasks = useGameStore.getState().tasks
          const idx = currentTasks.findIndex(t => t.id === task.id)
          if (idx !== -1) {
            const newTasks = [...currentTasks]
            newTasks[idx] = task
            setTasks(newTasks)
          }
          break
        }

        case 'message': {
          // Generic message from agent
          addMessage({
            agent_name: message.data.agent_name || message.data.agentName || 'Agent',
            type: message.data.messageType || 'chat',
            content: message.data.content || message.data.text,
            created_at: message.data.created_at || new Date().toISOString(),
          })
          break
        }

        case 'pong':
          // Heartbeat response
          break

        // Demo mode messages from server
        case 'demo_state':
          // Server is sending shared demo state
          setDemoMode(true)
          handleDemoState(message.data, setAgents, showBubble)
          break

        case 'agent_bubble':
          // Individual bubble event from demo
          handleAgentBubble(message.data, showBubble)
          break

        case 'demo_mode_started':
          console.log('[WS] Server demo mode started')
          setDemoMode(true)
          break

        case 'demo_mode_stopped':
          console.log('[WS] Server demo mode stopped')
          setDemoMode(false)
          break

        default:
          // Silently ignore unknown message types
          break
      }
    } catch (e) {
      console.error('[WS] Parse error:', e)
    }
  }, [setAgents, setTasks, setMessages, addMessage, addResult, addTaskFile, showBubble, setDemoMode, startAgentMove])

  // Store connect function ref for use in onclose
  const connectRef = useRef(null)

  const connect = useCallback(() => {
    // Prevent multiple simultaneous connection attempts
    if (wsRef.current?.readyState === WebSocket.OPEN || isConnectingRef.current) {
      return
    }

    isConnectingRef.current = true

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`
    
    // Only log on first attempt or after successful connections
    if (retryCountRef.current === 0) {
      console.log('[WS] Connecting...')
    }
    
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[WS] Connected')
      setConnected(true)
      retryCountRef.current = 0
      isConnectingRef.current = false
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
    }

    ws.onclose = () => {
      isConnectingRef.current = false
      wsRef.current = null
      
      // Only log disconnect if we were previously connected
      if (retryCountRef.current === 0) {
        setConnected(false)
      }
      
      // Exponential backoff for reconnect (max 10 seconds)
      const delay = Math.min(1000 * Math.pow(1.5, retryCountRef.current), 10000)
      retryCountRef.current++
      
      // Use ref to avoid closure issues
      reconnectTimeoutRef.current = setTimeout(() => {
        if (connectRef.current) connectRef.current()
      }, delay)
    }

    ws.onerror = () => {
      isConnectingRef.current = false
      // Silently handle errors - onclose will trigger reconnect
      // Only warn on repeated failures
      if (retryCountRef.current > 3) {
        console.warn('[WS] Connection failed - retrying...')
      }
    }

    ws.onmessage = handleMessage
  }, [setConnected, handleMessage])

  // Update ref when connect changes
  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
  }, [])

  const send = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  // Ping every 30 seconds to keep connection alive
  useEffect(() => {
    const pingInterval = setInterval(() => {
      send({ type: 'ping' })
    }, 30000)
    return () => clearInterval(pingInterval)
  }, [send])

  // Small delay before first connection to let backend initialize
  useEffect(() => {
    const initialDelay = setTimeout(connect, 100)
    return () => {
      clearTimeout(initialDelay)
      disconnect()
    }
  }, [connect, disconnect])

  return { send }
}
