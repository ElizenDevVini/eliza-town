/**
 * Visual Demo Mode - Server-side agent simulation
 * 
 * Runs a shared, stateful demo that all clients see the same state.
 * Simulates agent movement, speech, and activities.
 */

import type { WebSocketMessage } from '../websocket/index.js';

// Types
export interface DemoAgent {
  id: number;
  name: string;
  type: 'planner' | 'designer' | 'coder' | 'reviewer';
  status: 'idle' | 'traveling' | 'working' | 'thinking';
  current_hub: string;
}

export interface SpeechBubble {
  agentId: number;
  text: string;
  type: 'saying' | 'thinking';
  expiresAt: number;
}

export interface DemoState {
  agents: DemoAgent[];
  activeBubbles: SpeechBubble[];
  currentTask: string | null;
  taskProgress: number;
}

type BroadcastFn = (message: WebSocketMessage) => void;

// Hub definitions
const HUBS = {
  town_square: { x: 0, z: 0 },
  planning_room: { x: -18, z: -15 },
  design_studio: { x: 18, z: -15 },
  coding_desk: { x: -18, z: 15 },
  review_station: { x: 18, z: 15 },
  deploy_station: { x: 0, z: -25 },
};

// Agent-type to hub mapping
const AGENT_WORK_HUBS: Record<string, string> = {
  planner: 'planning_room',
  designer: 'design_studio',
  coder: 'coding_desk',
  reviewer: 'review_station',
};

// Demo quotes by agent type
const DEMO_QUOTES: Record<string, string[]> = {
  planner: [
    "Let me break this down into steps...",
    "I see three main components here.",
    "This needs design work first.",
    "Ada, you're up for the coding!",
    "Let's coordinate on this one.",
    "Time to plan the architecture.",
    "I'll outline the requirements.",
  ],
  designer: [
    "I'm thinking clean, minimal design.",
    "The color palette should be warm.",
    "Let's use a card-based layout.",
    "This needs better visual hierarchy.",
    "I'll sketch out the wireframes.",
    "Typography is key here.",
    "Let me create a mockup.",
  ],
  coder: [
    "Writing the main component now...",
    "This function needs refactoring.",
    "Adding error handling here.",
    "Almost done with this feature!",
    "Let me add some tests.",
    "Optimizing the algorithm...",
    "Clean code, best code.",
  ],
  reviewer: [
    "Looking good so far!",
    "Found a small issue here.",
    "Nice clean code, approved!",
    "Consider adding more comments.",
    "This passes all checks.",
    "Great test coverage!",
    "Let me verify this edge case.",
  ],
};

// Task templates for the demo
const DEMO_TASKS = [
  "Build a todo app",
  "Create a weather widget",
  "Design a landing page",
  "Write API documentation",
  "Implement dark mode",
  "Add user authentication",
  "Create data visualizations",
  "Build a chat interface",
];

// State - Use same agent names as real ElizaOS agents for consistency
let demoState: DemoState = {
  agents: [
    { id: 1, name: 'Eliza', type: 'planner', status: 'idle', current_hub: 'planning_room' },
    { id: 2, name: 'Marcus', type: 'designer', status: 'idle', current_hub: 'design_studio' },
    { id: 3, name: 'Ada', type: 'coder', status: 'idle', current_hub: 'coding_desk' },
    { id: 4, name: 'Clara', type: 'reviewer', status: 'idle', current_hub: 'review_station' },
  ],
  activeBubbles: [],
  currentTask: null,
  taskProgress: 0,
};

let broadcastFn: BroadcastFn | null = null;
let demoInterval: NodeJS.Timeout | null = null;
let tickCount = 0;
let isRunning = false;

/**
 * Get current demo state for new clients
 */
export function getDemoState(): DemoState {
  // Clean expired bubbles
  const now = Date.now();
  demoState.activeBubbles = demoState.activeBubbles.filter(b => b.expiresAt > now);
  
  return { ...demoState };
}

/**
 * Broadcast current state to all clients
 */
function broadcastState(): void {
  if (!broadcastFn) return;
  
  // Clean expired bubbles
  const now = Date.now();
  demoState.activeBubbles = demoState.activeBubbles.filter(b => b.expiresAt > now);
  
  broadcastFn({
    type: 'demo_state',
    data: {
      agents: demoState.agents,
      bubbles: demoState.activeBubbles.map(b => ({
        agentId: b.agentId,
        text: b.text,
        type: b.type,
        ttl: b.expiresAt - now,
      })),
      currentTask: demoState.currentTask,
      taskProgress: demoState.taskProgress,
    },
  });
}

/**
 * Show a speech bubble for an agent
 */
function showBubble(agentId: number, text: string, type: 'saying' | 'thinking' = 'saying', duration = 4000): void {
  // Remove any existing bubble for this agent
  demoState.activeBubbles = demoState.activeBubbles.filter(b => b.agentId !== agentId);
  
  // Add new bubble
  demoState.activeBubbles.push({
    agentId,
    text,
    type,
    expiresAt: Date.now() + duration,
  });
  
  // Broadcast bubble event
  if (broadcastFn) {
    broadcastFn({
      type: 'agent_bubble',
      data: { agentId, text, type, duration },
    });
  }
}

/**
 * Move an agent to a hub
 */
function moveAgent(agentId: number, targetHub: string): void {
  const agent = demoState.agents.find(a => a.id === agentId);
  if (!agent || agent.current_hub === targetHub) return;
  
  agent.status = 'traveling';
  
  // Broadcast movement start
  if (broadcastFn) {
    broadcastFn({
      type: 'agent_move',
      data: { agentId, from: agent.current_hub, to: targetHub },
    });
  }
  
  // Complete movement after delay
  setTimeout(() => {
    const a = demoState.agents.find(ag => ag.id === agentId);
    if (a) {
      a.current_hub = targetHub;
      a.status = 'idle';
      broadcastState();
    }
  }, 2000);
}

/**
 * Make an agent work
 */
function agentWork(agent: DemoAgent): void {
  const quotes = DEMO_QUOTES[agent.type] || DEMO_QUOTES.coder;
  const quote = quotes[Math.floor(Math.random() * quotes.length)];
  const workHub = AGENT_WORK_HUBS[agent.type];
  
  // If not at work hub, move there first
  if (agent.current_hub !== workHub) {
    moveAgent(agent.id, workHub);
    
    // Then work after arriving
    setTimeout(() => {
      const a = demoState.agents.find(ag => ag.id === agent.id);
      if (a && a.status === 'idle') {
        a.status = 'working';
        showBubble(a.id, quote, 'saying', 3500);
        broadcastState();
        
        // Return to idle after working
        setTimeout(() => {
          const ag = demoState.agents.find(x => x.id === agent.id);
          if (ag) {
            ag.status = 'idle';
            broadcastState();
          }
        }, 4000);
      }
    }, 2500);
  } else {
    // Already at work hub, just work
    agent.status = 'working';
    showBubble(agent.id, quote, 'saying', 3500);
    broadcastState();
    
    // Return to idle after working
    setTimeout(() => {
      const a = demoState.agents.find(ag => ag.id === agent.id);
      if (a) {
        a.status = 'idle';
        broadcastState();
      }
    }, 4000);
  }
}

/**
 * Start a new task in the demo
 */
function startNewTask(): void {
  const task = DEMO_TASKS[Math.floor(Math.random() * DEMO_TASKS.length)];
  demoState.currentTask = task;
  demoState.taskProgress = 0;
  
  // Planner announces the task
  const planner = demoState.agents.find(a => a.type === 'planner');
  if (planner) {
    showBubble(planner.id, `New task: ${task}! Let's get started.`, 'saying', 5000);
  }
  
  broadcastState();
}

/**
 * Demo tick - runs every few seconds
 */
function demoTick(): void {
  tickCount++;
  
  // Every 30 ticks (~60 seconds), start a new task
  if (tickCount % 30 === 0 || !demoState.currentTask) {
    startNewTask();
    return;
  }
  
  // Update task progress
  if (demoState.currentTask && demoState.taskProgress < 100) {
    demoState.taskProgress = Math.min(100, demoState.taskProgress + Math.floor(Math.random() * 15) + 5);
    
    if (demoState.taskProgress >= 100) {
      // Task complete!
      const reviewer = demoState.agents.find(a => a.type === 'reviewer');
      if (reviewer) {
        showBubble(reviewer.id, "Task complete! Great teamwork everyone!", 'saying', 4000);
      }
    }
  }
  
  // Pick a random idle agent to do something
  const idleAgents = demoState.agents.filter(a => a.status === 'idle');
  if (idleAgents.length > 0 && Math.random() > 0.3) {
    const agent = idleAgents[Math.floor(Math.random() * idleAgents.length)];
    
    // Sometimes move to town square to "collaborate"
    if (Math.random() > 0.7 && agent.current_hub !== 'town_square') {
      moveAgent(agent.id, 'town_square');
      setTimeout(() => {
        const a = demoState.agents.find(ag => ag.id === agent.id);
        if (a && a.status === 'idle') {
          showBubble(a.id, "Checking in with the team...", 'saying', 3000);
        }
      }, 2500);
    } else {
      agentWork(agent);
    }
  }
  
  broadcastState();
}

/**
 * Start the visual demo
 */
export function startVisualDemo(broadcast: BroadcastFn): void {
  if (isRunning) {
    console.log('[VisualDemo] Already running');
    return;
  }
  
  broadcastFn = broadcast;
  isRunning = true;
  tickCount = 0;
  
  // Reset state - Use same agent names as real ElizaOS agents for consistency
  demoState = {
    agents: [
      { id: 1, name: 'Eliza', type: 'planner', status: 'idle', current_hub: 'planning_room' },
      { id: 2, name: 'Marcus', type: 'designer', status: 'idle', current_hub: 'design_studio' },
      { id: 3, name: 'Ada', type: 'coder', status: 'idle', current_hub: 'coding_desk' },
      { id: 4, name: 'Clara', type: 'reviewer', status: 'idle', current_hub: 'review_station' },
    ],
    activeBubbles: [],
    currentTask: null,
    taskProgress: 0,
  };
  
  console.log('[VisualDemo] Starting server-side visual demo');
  
  // Initial broadcast
  broadcastState();
  
  // Start demo loop (every 2 seconds)
  demoInterval = setInterval(demoTick, 2000);
  
  // Welcome message after a short delay
  setTimeout(() => {
    const planner = demoState.agents.find(a => a.type === 'planner');
    if (planner) {
      showBubble(planner.id, "Welcome to Eliza Town! We're a team of AI agents.", 'saying', 5000);
    }
  }, 1000);
}

/**
 * Stop the visual demo
 */
export function stopVisualDemo(): void {
  if (!isRunning) return;
  
  isRunning = false;
  
  if (demoInterval) {
    clearInterval(demoInterval);
    demoInterval = null;
  }
  
  console.log('[VisualDemo] Stopped');
}

/**
 * Check if demo is running
 */
export function isVisualDemoRunning(): boolean {
  return isRunning;
}
