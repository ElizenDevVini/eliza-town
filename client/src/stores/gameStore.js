import { create } from 'zustand'

/**
 * Hub positions - must match server
 */
export const HUBS = {
  town_square: { x: 0, z: 0 },
  planning_room: { x: -18, z: -15 },
  design_studio: { x: 18, z: -15 },
  coding_desk: { x: -18, z: 15 },
  review_station: { x: 18, z: 15 },
  deploy_station: { x: 0, z: -25 },
}

/**
 * Waypoints for pathfinding
 */
export const WAYPOINTS = {
  town_square: { x: 0, z: 0 },
  planning_room: { x: -18, z: -15 },
  design_studio: { x: 18, z: -15 },
  coding_desk: { x: -18, z: 15 },
  review_station: { x: 18, z: 15 },
  deploy_station: { x: 0, z: -25 },
  west_road: { x: -8, z: 0 },
  east_road: { x: 8, z: 0 },
  north_road: { x: 0, z: -12 },
  south_road: { x: 0, z: 12 },
  southwest: { x: -10, z: 8 },
  southeast: { x: 10, z: 8 },
}

/**
 * Paths between hubs via waypoints
 */
export const PATHS = {
  town_square: {
    planning_room: ['west_road', 'planning_room'],
    design_studio: ['east_road', 'design_studio'],
    coding_desk: ['west_road', 'southwest', 'coding_desk'],
    review_station: ['east_road', 'southeast', 'review_station'],
    deploy_station: ['north_road', 'deploy_station'],
  },
  planning_room: {
    town_square: ['west_road', 'town_square'],
    design_studio: ['west_road', 'town_square', 'east_road', 'design_studio'],
    coding_desk: ['west_road', 'southwest', 'coding_desk'],
    review_station: ['west_road', 'town_square', 'east_road', 'southeast', 'review_station'],
    deploy_station: ['west_road', 'town_square', 'north_road', 'deploy_station'],
  },
  design_studio: {
    town_square: ['east_road', 'town_square'],
    planning_room: ['east_road', 'town_square', 'west_road', 'planning_room'],
    coding_desk: ['east_road', 'town_square', 'west_road', 'southwest', 'coding_desk'],
    review_station: ['east_road', 'southeast', 'review_station'],
    deploy_station: ['east_road', 'town_square', 'north_road', 'deploy_station'],
  },
  coding_desk: {
    town_square: ['southwest', 'west_road', 'town_square'],
    planning_room: ['southwest', 'west_road', 'planning_room'],
    design_studio: ['southwest', 'west_road', 'town_square', 'east_road', 'design_studio'],
    review_station: ['southwest', 'west_road', 'town_square', 'east_road', 'southeast', 'review_station'],
    deploy_station: ['southwest', 'west_road', 'town_square', 'north_road', 'deploy_station'],
  },
  review_station: {
    town_square: ['southeast', 'east_road', 'town_square'],
    planning_room: ['southeast', 'east_road', 'town_square', 'west_road', 'planning_room'],
    design_studio: ['southeast', 'east_road', 'design_studio'],
    coding_desk: ['southeast', 'east_road', 'town_square', 'west_road', 'southwest', 'coding_desk'],
    deploy_station: ['southeast', 'east_road', 'town_square', 'north_road', 'deploy_station'],
  },
  deploy_station: {
    town_square: ['north_road', 'town_square'],
    planning_room: ['north_road', 'town_square', 'west_road', 'planning_room'],
    design_studio: ['north_road', 'town_square', 'east_road', 'design_studio'],
    coding_desk: ['north_road', 'town_square', 'west_road', 'southwest', 'coding_desk'],
    review_station: ['north_road', 'town_square', 'east_road', 'southeast', 'review_station'],
  },
}

/**
 * Get path from one hub to another
 */
export function getPath(fromHub, toHub) {
  if (fromHub === toHub) return []
  return PATHS[fromHub]?.[toHub] || [toHub]
}

/**
 * Normalize agent ID to string for consistent comparison
 */
export function normalizeAgentId(id) {
  if (id === null || id === undefined) return null
  return String(id)
}

/**
 * Main game store - manages all state from the ElizaOS backend
 */
export const useGameStore = create((set, get) => ({
  // Connection state
  connected: false,
  serverOnline: false,
  demoMode: false, // True when server is running shared visual demo
  
  // Agents from ElizaOS - includes interpolated position data
  agents: [],
  
  // Agent movement state - tracks current interpolated positions and paths
  // Key is normalized agent ID (string)
  agentMovement: new Map(),
  
  // Tasks
  tasks: [],
  
  // Activity messages
  messages: [],
  
  // Completed results with files
  results: [],
  
  // Task files
  taskFiles: new Map(),
  
  // Selected agent for modal
  selectedAgent: null,
  
  // Actions
  setConnected: (connected) => set({ connected }),
  setServerOnline: (serverOnline) => set({ serverOnline }),
  setDemoMode: (demoMode) => set({ demoMode }),
  
  /**
   * Set agents - also initializes movement state for new agents
   */
  setAgents: (agentsOrUpdater) => set((state) => {
    const newAgents = typeof agentsOrUpdater === 'function' 
      ? agentsOrUpdater(state.agents) 
      : agentsOrUpdater
    
    const movement = new Map(state.agentMovement)
    
    // Initialize movement state for each agent
    for (const agent of newAgents) {
      const id = normalizeAgentId(agent.id)
      if (!id) continue
      
      const existing = movement.get(id)
      const hub = agent.current_hub || 'town_square'
      const hubPos = HUBS[hub] || HUBS.town_square
      
      if (!existing) {
        // New agent - initialize at hub position
        movement.set(id, {
          x: hubPos.x,
          z: hubPos.z,
          targetHub: hub,
          currentHub: hub,
          path: [],
          pathIndex: 0,
          isMoving: false,
        })
      } else if (agent.current_hub && agent.current_hub !== existing.targetHub) {
        // Hub changed - set up movement path
        const path = getPath(existing.currentHub, agent.current_hub)
        movement.set(id, {
          ...existing,
          targetHub: agent.current_hub,
          path,
          pathIndex: 0,
          isMoving: path.length > 0,
        })
      }
    }
    
    return { agents: newAgents, agentMovement: movement }
  }),
  
  /**
   * Start agent movement to a hub
   */
  startAgentMove: (agentId, targetHub) => set((state) => {
    const id = normalizeAgentId(agentId)
    if (!id) return state
    
    const movement = new Map(state.agentMovement)
    const existing = movement.get(id) || { 
      x: 0, z: 0, 
      currentHub: 'town_square', 
      targetHub: 'town_square',
      path: [], 
      pathIndex: 0,
      isMoving: false 
    }
    
    if (existing.currentHub === targetHub) return state
    
    const path = getPath(existing.currentHub, targetHub)
    movement.set(id, {
      ...existing,
      targetHub,
      path,
      pathIndex: 0,
      isMoving: path.length > 0,
    })
    
    return { agentMovement: movement }
  }),
  
  /**
   * Update agent interpolated position (called from animation frame)
   */
  updateAgentPosition: (agentId, x, z, arrivedAtWaypoint = false) => {
    const id = normalizeAgentId(agentId)
    if (!id) return
    
    const state = get()
    const movement = new Map(state.agentMovement)
    const existing = movement.get(id)
    
    if (!existing) return
    
    const updated = { ...existing, x, z }
    
    if (arrivedAtWaypoint) {
      const nextIndex = existing.pathIndex + 1
      if (nextIndex >= existing.path.length) {
        // Arrived at final destination
        updated.pathIndex = 0
        updated.path = []
        updated.isMoving = false
        updated.currentHub = existing.targetHub
      } else {
        // Move to next waypoint
        updated.pathIndex = nextIndex
      }
    }
    
    movement.set(id, updated)
    set({ agentMovement: movement })
  },
  
  /**
   * Get current movement state for an agent
   */
  getAgentMovement: (agentId) => {
    const id = normalizeAgentId(agentId)
    if (!id) return null
    return get().agentMovement.get(id) || null
  },
  
  setTasks: (tasks) => set({ tasks }),
  
  setMessages: (messages) => set({ messages }),
  
  addMessage: (message) => set((state) => ({
    messages: [message, ...state.messages].slice(0, 50)
  })),
  
  addResult: (result) => set((state) => ({
    results: [result, ...state.results].slice(0, 10)
  })),
  
  addTaskFile: (taskId, file) => set((state) => {
    const files = new Map(state.taskFiles)
    const existing = files.get(taskId) || []
    files.set(taskId, [...existing, file])
    return { taskFiles: files }
  }),
  
  selectAgent: (agent) => set({ selectedAgent: agent }),
  clearSelectedAgent: () => set({ selectedAgent: null }),
  
  // Full state update from WebSocket
  updateState: (data) => set({
    agents: data.agents || [],
    tasks: data.tasks || [],
    messages: data.messages || [],
  }),
}))

/**
 * Agent speech bubbles store
 */
export const useBubbleStore = create((set) => ({
  bubbles: new Map(), // agentId -> { text, type, expiresAt }
  
  showBubble: (agentId, text, type = 'saying', duration = 4000) => set((state) => {
    const id = normalizeAgentId(agentId)
    if (!id) return state
    
    const bubbles = new Map(state.bubbles)
    bubbles.set(id, {
      text,
      type,
      expiresAt: Date.now() + duration
    })
    return { bubbles }
  }),
  
  clearBubble: (agentId) => set((state) => {
    const id = normalizeAgentId(agentId)
    if (!id) return state
    
    const bubbles = new Map(state.bubbles)
    bubbles.delete(id)
    return { bubbles }
  }),
  
  clearExpired: () => set((state) => {
    const now = Date.now()
    const bubbles = new Map(state.bubbles)
    for (const [id, bubble] of bubbles) {
      if (bubble.expiresAt < now) {
        bubbles.delete(id)
      }
    }
    return { bubbles }
  }),
}))
