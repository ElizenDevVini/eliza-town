/**
 * Tests for agent movement system
 * 
 * Run with: npm test (in client directory)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { 
  HUBS, 
  WAYPOINTS, 
  PATHS, 
  getPath, 
  normalizeAgentId,
  useGameStore 
} from './gameStore.js'

// Reset store before each test
beforeEach(() => {
  useGameStore.setState({ 
    agents: [], 
    agentMovement: new Map(),
    connected: false,
    serverOnline: false,
    demoMode: false,
    tasks: [],
    messages: [],
    results: [],
    taskFiles: new Map(),
    selectedAgent: null,
  })
})

// ============================================================================
// Hub and Waypoint Tests
// ============================================================================

describe('Hub Configuration', () => {
  it('All hubs have valid positions', () => {
    for (const [, pos] of Object.entries(HUBS)) {
      expect(typeof pos.x).toBe('number')
      expect(typeof pos.z).toBe('number')
    }
  })

  it('All waypoints have valid positions', () => {
    for (const [, pos] of Object.entries(WAYPOINTS)) {
      expect(typeof pos.x).toBe('number')
      expect(typeof pos.z).toBe('number')
    }
  })

  it('Hubs are included in waypoints', () => {
    for (const hubName of Object.keys(HUBS)) {
      expect(WAYPOINTS[hubName]).toBeTruthy()
    }
  })
})

// ============================================================================
// Path Finding Tests
// ============================================================================

describe('Path Finding', () => {
  it('Path from hub to itself is empty', () => {
    const path = getPath('town_square', 'town_square')
    expect(path).toEqual([])
  })

  it('Direct paths exist between all hub pairs', () => {
    const hubNames = Object.keys(HUBS)
    for (const from of hubNames) {
      for (const to of hubNames) {
        if (from !== to) {
          const path = getPath(from, to)
          expect(path.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('Path from town_square to planning_room is valid', () => {
    const path = getPath('town_square', 'planning_room')
    expect(path.length).toBeGreaterThan(0)
    // Should end at planning_room
    expect(path[path.length - 1]).toBe('planning_room')
  })

  it('Path from planning_room to coding_desk goes through waypoints', () => {
    const path = getPath('planning_room', 'coding_desk')
    expect(path.length).toBeGreaterThan(1)
    // All waypoints in path should be valid
    for (const wp of path) {
      expect(WAYPOINTS[wp]).toBeTruthy()
    }
  })

  it('Paths dont have consecutive duplicates', () => {
    const hubNames = Object.keys(HUBS)
    for (const from of hubNames) {
      for (const to of hubNames) {
        if (from !== to) {
          const path = getPath(from, to)
          for (let i = 1; i < path.length; i++) {
            expect(path[i]).not.toBe(path[i-1])
          }
        }
      }
    }
  })

  it('All paths end at the destination hub', () => {
    const hubNames = Object.keys(HUBS)
    for (const from of hubNames) {
      for (const to of hubNames) {
        if (from !== to) {
          const path = getPath(from, to)
          expect(path[path.length - 1]).toBe(to)
        }
      }
    }
  })
})

// ============================================================================
// Agent ID Normalization Tests
// ============================================================================

describe('Agent ID Normalization', () => {
  it('handles numbers', () => {
    expect(normalizeAgentId(1)).toBe('1')
    expect(normalizeAgentId(123)).toBe('123')
  })

  it('handles strings', () => {
    expect(normalizeAgentId('1')).toBe('1')
    expect(normalizeAgentId('agent-1')).toBe('agent-1')
  })

  it('handles null/undefined', () => {
    expect(normalizeAgentId(null)).toBe(null)
    expect(normalizeAgentId(undefined)).toBe(null)
  })

  it('produces consistent results for number and string', () => {
    const id1 = normalizeAgentId(1)
    const id2 = normalizeAgentId('1')
    expect(id1).toBe(id2)
  })
})

// ============================================================================
// Movement State Tests
// ============================================================================

describe('Movement State', () => {
  it('New agents get initialized at their hub position', () => {
    const agents = [
      { id: 1, name: 'Test', type: 'coder', status: 'idle', current_hub: 'coding_desk' }
    ]
    useGameStore.getState().setAgents(agents)
    
    const movement = useGameStore.getState().getAgentMovement(1)
    expect(movement).toBeTruthy()
    expect(movement.x).toBe(HUBS.coding_desk.x)
    expect(movement.z).toBe(HUBS.coding_desk.z)
    expect(movement.currentHub).toBe('coding_desk')
    expect(movement.isMoving).toBe(false)
  })

  it('Agent hub change triggers movement path', () => {
    // Add an agent at coding_desk
    const agents = [
      { id: 1, name: 'Test', type: 'coder', status: 'idle', current_hub: 'coding_desk' }
    ]
    useGameStore.getState().setAgents(agents)
    
    // Now change agent's hub to planning_room
    const updatedAgents = [
      { id: 1, name: 'Test', type: 'coder', status: 'traveling', current_hub: 'planning_room' }
    ]
    useGameStore.getState().setAgents(updatedAgents)
    
    // Check movement state has a path
    const movement = useGameStore.getState().getAgentMovement(1)
    expect(movement).toBeTruthy()
    expect(movement.targetHub).toBe('planning_room')
    expect(movement.path.length).toBeGreaterThan(0)
    expect(movement.isMoving).toBe(true)
  })

  it('startAgentMove creates correct path', () => {
    const agents = [
      { id: 1, name: 'Test', type: 'coder', status: 'idle', current_hub: 'town_square' }
    ]
    useGameStore.getState().setAgents(agents)
    
    useGameStore.getState().startAgentMove(1, 'design_studio')
    
    const movement = useGameStore.getState().getAgentMovement(1)
    expect(movement.targetHub).toBe('design_studio')
    expect(movement.path).toContain('design_studio')
    expect(movement.isMoving).toBe(true)
  })

  it('updateAgentPosition updates coordinates', () => {
    const agents = [
      { id: 1, name: 'Test', type: 'coder', status: 'idle', current_hub: 'town_square' }
    ]
    useGameStore.getState().setAgents(agents)
    
    useGameStore.getState().updateAgentPosition(1, 5.5, 3.2, false)
    
    const movement = useGameStore.getState().getAgentMovement(1)
    expect(movement.x).toBe(5.5)
    expect(movement.z).toBe(3.2)
  })

  it('updateAgentPosition with arrival advances path', () => {
    const agents = [
      { id: 1, name: 'Test', type: 'coder', status: 'idle', current_hub: 'town_square' }
    ]
    useGameStore.getState().setAgents(agents)
    useGameStore.getState().startAgentMove(1, 'planning_room')
    
    const initialMovement = useGameStore.getState().getAgentMovement(1)
    const initialPathIndex = initialMovement.pathIndex
    
    // Simulate arrival at first waypoint
    useGameStore.getState().updateAgentPosition(1, 0, 0, true)
    
    const updatedMovement = useGameStore.getState().getAgentMovement(1)
    expect(updatedMovement.pathIndex).toBe(initialPathIndex + 1)
  })
})

// ============================================================================
// Position Consistency Tests (Prevents Jumping)
// ============================================================================

describe('Position Consistency (Anti-Jump)', () => {
  it('Agent position persists across setAgents calls', () => {
    const agents = [
      { id: 1, name: 'Test', type: 'coder', status: 'idle', current_hub: 'town_square' }
    ]
    useGameStore.getState().setAgents(agents)
    
    // Move position partway
    useGameStore.getState().updateAgentPosition(1, 5, 5, false)
    
    // Call setAgents again with same hub (simulating state update)
    useGameStore.getState().setAgents([
      { id: 1, name: 'Test', type: 'coder', status: 'idle', current_hub: 'town_square' }
    ])
    
    // Position should be preserved (not reset to hub position)
    const movement = useGameStore.getState().getAgentMovement(1)
    expect(movement.x).toBe(5)
    expect(movement.z).toBe(5)
  })

  it('Multiple agents have independent positions', () => {
    const agents = [
      { id: 1, name: 'Agent1', type: 'coder', status: 'idle', current_hub: 'coding_desk' },
      { id: 2, name: 'Agent2', type: 'designer', status: 'idle', current_hub: 'design_studio' },
    ]
    useGameStore.getState().setAgents(agents)
    
    const movement1 = useGameStore.getState().getAgentMovement(1)
    const movement2 = useGameStore.getState().getAgentMovement(2)
    
    expect(movement1.x).toBe(HUBS.coding_desk.x)
    expect(movement2.x).toBe(HUBS.design_studio.x)
    
    // Update one agent's position
    useGameStore.getState().updateAgentPosition(1, 10, 10, false)
    
    // Other agent should be unaffected
    const movement2After = useGameStore.getState().getAgentMovement(2)
    expect(movement2After.x).toBe(HUBS.design_studio.x)
  })

  it('Agent movement completes correctly', () => {
    const agents = [
      { id: 1, name: 'Test', type: 'coder', status: 'idle', current_hub: 'town_square' }
    ]
    useGameStore.getState().setAgents(agents)
    
    useGameStore.getState().startAgentMove(1, 'planning_room')
    
    let movement = useGameStore.getState().getAgentMovement(1)
    const pathLength = movement.path.length
    
    // Simulate arriving at each waypoint
    for (let i = 0; i < pathLength; i++) {
      useGameStore.getState().updateAgentPosition(1, 0, 0, true)
    }
    
    // Should no longer be moving
    movement = useGameStore.getState().getAgentMovement(1)
    expect(movement.isMoving).toBe(false)
    expect(movement.currentHub).toBe('planning_room')
  })

  it('Position does not jump when hub stays same', () => {
    const agents = [
      { id: 1, name: 'Test', type: 'coder', status: 'idle', current_hub: 'coding_desk' }
    ]
    useGameStore.getState().setAgents(agents)
    
    // Set a custom position
    useGameStore.getState().updateAgentPosition(1, 100, 200, false)
    
    // Receive multiple state updates with same hub
    for (let i = 0; i < 5; i++) {
      useGameStore.getState().setAgents([
        { id: 1, name: 'Test', type: 'coder', status: 'working', current_hub: 'coding_desk' }
      ])
    }
    
    // Position should still be our custom position
    const movement = useGameStore.getState().getAgentMovement(1)
    expect(movement.x).toBe(100)
    expect(movement.z).toBe(200)
  })

  it('Only hub change triggers path calculation', () => {
    const agents = [
      { id: 1, name: 'Test', type: 'coder', status: 'idle', current_hub: 'coding_desk' }
    ]
    useGameStore.getState().setAgents(agents)
    
    // Update status but not hub
    useGameStore.getState().setAgents([
      { id: 1, name: 'Test', type: 'coder', status: 'working', current_hub: 'coding_desk' }
    ])
    
    const movement = useGameStore.getState().getAgentMovement(1)
    // Should not be moving since hub didn't change
    expect(movement.isMoving).toBe(false)
    expect(movement.path).toEqual([])
  })
})

// ============================================================================
// Edge Case Tests
// ============================================================================

describe('Edge Cases', () => {
  it('Unknown hub defaults gracefully', () => {
    const path = getPath('town_square', 'unknown_hub')
    expect(Array.isArray(path)).toBe(true)
  })

  it('Agent with missing hub initializes at town_square', () => {
    const agents = [
      { id: 1, name: 'Test', type: 'coder', status: 'idle' }
    ]
    useGameStore.getState().setAgents(agents)
    
    const movement = useGameStore.getState().getAgentMovement(1)
    expect(movement.x).toBe(HUBS.town_square.x)
    expect(movement.z).toBe(HUBS.town_square.z)
  })

  it('Rapid setAgents calls dont break movement', () => {
    for (let i = 0; i < 10; i++) {
      useGameStore.getState().setAgents([
        { id: 1, name: 'Test', type: 'coder', status: 'idle', current_hub: 'town_square' }
      ])
    }
    
    const movement = useGameStore.getState().getAgentMovement(1)
    expect(movement).toBeTruthy()
    expect(typeof movement.x).toBe('number')
    expect(typeof movement.z).toBe('number')
  })

  it('String and number IDs work interchangeably', () => {
    useGameStore.getState().setAgents([
      { id: 1, name: 'Test', type: 'coder', status: 'idle', current_hub: 'town_square' }
    ])
    
    // Query with string
    const movement1 = useGameStore.getState().getAgentMovement('1')
    expect(movement1).toBeTruthy()
    
    // Query with number
    const movement2 = useGameStore.getState().getAgentMovement(1)
    expect(movement2).toBeTruthy()
    
    // Should be the same position
    expect(movement1.x).toBe(movement2.x)
    expect(movement1.z).toBe(movement2.z)
  })
})

// ============================================================================
// Interpolation Simulation Tests
// ============================================================================

describe('Movement Interpolation', () => {
  it('Simulates smooth movement from town_square to planning_room', () => {
    useGameStore.getState().setAgents([
      { id: 1, name: 'Test', type: 'coder', status: 'idle', current_hub: 'town_square' }
    ])
    
    useGameStore.getState().startAgentMove(1, 'planning_room')
    
    const positions = []
    let movement = useGameStore.getState().getAgentMovement(1)
    positions.push({ x: movement.x, z: movement.z })
    
    // Simulate up to 2000 frames of movement (enough to reach any destination)
    const MAX_FRAMES = 2000
    for (let frame = 0; frame < MAX_FRAMES && movement.isMoving; frame++) {
      const { x, z, path, pathIndex, targetHub } = movement
      
      // Get current target
      let targetPos
      if (path.length > 0 && pathIndex < path.length) {
        const waypointName = path[pathIndex]
        targetPos = WAYPOINTS[waypointName] || HUBS[targetHub]
      } else {
        targetPos = HUBS[targetHub]
      }
      
      // Calculate movement
      const dx = targetPos.x - x
      const dz = targetPos.z - z
      const dist = Math.sqrt(dx * dx + dz * dz)
      
      if (dist > 0.5) {
        const speed = 4 * 0.016 // 4 units/sec * 16ms delta
        const moveAmount = Math.min(speed, dist)
        const newX = x + (dx / dist) * moveAmount
        const newZ = z + (dz / dist) * moveAmount
        useGameStore.getState().updateAgentPosition(1, newX, newZ, false)
        positions.push({ x: newX, z: newZ })
      } else {
        useGameStore.getState().updateAgentPosition(1, targetPos.x, targetPos.z, true)
        positions.push({ x: targetPos.x, z: targetPos.z })
      }
      
      movement = useGameStore.getState().getAgentMovement(1)
    }
    
    // Verify smooth movement (no large jumps between consecutive frames)
    for (let i = 1; i < positions.length; i++) {
      const dx = positions[i].x - positions[i-1].x
      const dz = positions[i].z - positions[i-1].z
      const dist = Math.sqrt(dx * dx + dz * dz)
      
      // No single frame should move more than 1 unit (at 60fps with speed 4)
      expect(dist).toBeLessThan(1)
    }
    
    // Should end at planning_room
    const finalMovement = useGameStore.getState().getAgentMovement(1)
    expect(finalMovement.currentHub).toBe('planning_room')
    expect(finalMovement.isMoving).toBe(false)
  })

  it('Movement between all hub pairs has no jumps', () => {
    const hubNames = ['town_square', 'planning_room', 'design_studio']
    
    for (const from of hubNames) {
      for (const to of hubNames) {
        if (from === to) continue
        
        // Reset
        useGameStore.setState({ agents: [], agentMovement: new Map() })
        
        useGameStore.getState().setAgents([
          { id: 1, name: 'Test', type: 'coder', status: 'idle', current_hub: from }
        ])
        
        useGameStore.getState().startAgentMove(1, to)
        
        let prevPos = useGameStore.getState().getAgentMovement(1)
        let movement = prevPos
        let maxJump = 0
        
        // Simulate movement
        for (let frame = 0; frame < 2000 && movement.isMoving; frame++) {
          const { x, z, path, pathIndex, targetHub } = movement
          
          let targetPos
          if (path.length > 0 && pathIndex < path.length) {
            targetPos = WAYPOINTS[path[pathIndex]] || HUBS[targetHub]
          } else {
            targetPos = HUBS[targetHub]
          }
          
          const dx = targetPos.x - x
          const dz = targetPos.z - z
          const dist = Math.sqrt(dx * dx + dz * dz)
          
          if (dist > 0.5) {
            const speed = 4 * 0.016
            const moveAmount = Math.min(speed, dist)
            const newX = x + (dx / dist) * moveAmount
            const newZ = z + (dz / dist) * moveAmount
            useGameStore.getState().updateAgentPosition(1, newX, newZ, false)
          } else {
            useGameStore.getState().updateAgentPosition(1, targetPos.x, targetPos.z, true)
          }
          
          const newMovement = useGameStore.getState().getAgentMovement(1)
          const jumpDx = newMovement.x - prevPos.x
          const jumpDz = newMovement.z - prevPos.z
          const jumpDist = Math.sqrt(jumpDx * jumpDx + jumpDz * jumpDz)
          
          if (jumpDist > maxJump) maxJump = jumpDist
          
          prevPos = newMovement
          movement = newMovement
        }
        
        // No jump should exceed movement speed
        expect(maxJump).toBeLessThan(1)
      }
    }
  })
})
