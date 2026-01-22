import { useEffect, useRef } from 'react'
import { useGameStore, normalizeAgentId } from '../stores/gameStore'

// Default agents for demo mode (fallback if server hasn't sent state yet)
const DEMO_AGENTS = [
  { id: 1, name: 'Eliza', type: 'planner', status: 'idle', current_hub: 'planning_room' },
  { id: 2, name: 'Luna', type: 'designer', status: 'idle', current_hub: 'design_studio' },
  { id: 3, name: 'Ada', type: 'coder', status: 'idle', current_hub: 'coding_desk' },
  { id: 4, name: 'Marcus', type: 'reviewer', status: 'idle', current_hub: 'review_station' },
]

/**
 * Demo mode hook - receives shared state from server
 * The demo runs on the server and is the same for all clients
 */
export function useDemoMode() {
  const connected = useGameStore((s) => s.connected)
  const demoMode = useGameStore((s) => s.demoMode)
  const agents = useGameStore((s) => s.agents)
  const setAgents = useGameStore((s) => s.setAgents)
  
  const hasInitializedRef = useRef(false)
  const timeoutRef = useRef(null)
  
  useEffect(() => {
    // Clear any pending timeout on cleanup
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])
  
  useEffect(() => {
    // If we're connected and in demo mode, the server handles everything
    if (connected && demoMode) {
      hasInitializedRef.current = true
      return
    }
    
    // If we're connected but not in demo mode, we're in real mode - do nothing
    if (connected && !demoMode) {
      hasInitializedRef.current = true
      return
    }
    
    // Only show fallback agents if:
    // 1. We're not connected
    // 2. We don't have any agents yet
    // 3. We haven't initialized before (first load)
    // 4. We've waited a bit for the initial connection
    if (!connected && agents.length === 0 && !hasInitializedRef.current) {
      // Wait 2 seconds before showing fallback - give time for WS to connect
      timeoutRef.current = setTimeout(() => {
        // Check again in case we connected during the wait
        const state = useGameStore.getState()
        if (!state.connected && state.agents.length === 0) {
          console.log('[Demo] Using fallback demo agents')
          setAgents(DEMO_AGENTS)
          hasInitializedRef.current = true
        }
      }, 2000)
    }
  }, [connected, demoMode, agents.length, setAgents])
}

/**
 * Handle demo state from server
 * Called by WebSocket when receiving demo_state messages
 */
export function handleDemoState(data, setAgents, showBubble) {
  if (!data) return
  
  // Update agents from server state
  if (data.agents && Array.isArray(data.agents)) {
    setAgents(data.agents)
  }
  
  // Show any active bubbles that haven't been shown yet
  // These come with the state for new clients joining mid-demo
  if (data.bubbles && Array.isArray(data.bubbles)) {
    for (const bubble of data.bubbles) {
      const id = normalizeAgentId(bubble.agentId)
      if (id && bubble.text && bubble.ttl > 0) {
        showBubble(id, bubble.text, bubble.type || 'saying', bubble.ttl)
      }
    }
  }
}

/**
 * Handle individual bubble event from server
 */
export function handleAgentBubble(data, showBubble) {
  if (!data) return
  const id = normalizeAgentId(data.agentId)
  if (id) {
    showBubble(id, data.text, data.type || 'saying', data.duration || 4000)
  }
}

/**
 * Handle agent move event from server
 */
export function handleAgentMove(data, setAgents) {
  if (!data) return
  const id = normalizeAgentId(data.agentId)
  
  setAgents(prev => prev.map(a => {
    const aId = normalizeAgentId(a.id)
    if (aId === id) {
      return { ...a, status: 'traveling', current_hub: data.to }
    }
    return a
  }))
}
