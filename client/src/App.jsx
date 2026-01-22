import { useEffect, useState } from 'react'
import { Scene3D } from './components/Scene3D'
import { AgentsPanel, TasksPanel, ResultsPanel, MessagesPanel, TaskInput } from './components/Panels'
import { AgentModal } from './components/AgentModal'
import { useWebSocket } from './hooks/useWebSocket'
import { useDemoMode } from './hooks/useDemoMode'
import { useGameStore } from './stores/gameStore'
import { checkHealth, getAgents, getTasks, getOrchestrationState } from './services/api'
import './styles/global.css'

function App() {
  const [loading, setLoading] = useState(true)
  const setAgents = useGameStore((s) => s.setAgents)
  const setTasks = useGameStore((s) => s.setTasks)
  const selectAgent = useGameStore((s) => s.selectAgent)
  const setServerOnline = useGameStore((s) => s.setServerOnline)
  
  // Connect WebSocket
  useWebSocket()
  
  // Enable demo mode when server is offline
  useDemoMode()
  
  // Check server health and fetch initial data periodically
  useEffect(() => {
    const fetchData = async () => {
      try {
        const health = await checkHealth()
        setServerOnline(health.status === 'ok' && health.dbAvailable)
        
        if (health.dbAvailable) {
          // Fetch agents
          try {
            const agents = await getAgents()
            if (agents && agents.length > 0) {
              setAgents(agents)
            }
          } catch (e) {
            console.warn('Failed to fetch agents:', e)
          }
          
          // Fetch tasks
          try {
            const tasks = await getTasks()
            if (tasks) {
              setTasks(tasks)
            }
          } catch (e) {
            console.warn('Failed to fetch tasks:', e)
          }
          
          // Fetch orchestration state for additional agent info
          try {
            const state = await getOrchestrationState()
            if (state.agents && state.agents.length > 0) {
              // Merge orchestration state with existing agents
              setAgents(() => {
                const currentAgents = useGameStore.getState().agents
                return currentAgents.map(agent => {
                  const stateAgent = state.agents.find(a => 
                    a.name === agent.name || a.agentId === agent.id
                  )
                  if (stateAgent) {
                    return {
                      ...agent,
                      current_hub: stateAgent.hub || agent.current_hub,
                      status: stateAgent.status || agent.status,
                      doing: stateAgent.doing || agent.doing,
                    }
                  }
                  return agent
                })
              })
            }
          } catch (e) {
            console.warn('Failed to fetch orchestration state:', e)
          }
        }
      } catch {
        setServerOnline(false)
      }
    }
    
    fetchData()
    const interval = setInterval(fetchData, 10000)
    return () => clearInterval(interval)
  }, [setServerOnline, setAgents, setTasks])
  
  // Hide loading after initial render
  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1500)
    return () => clearTimeout(timer)
  }, [])
  
  const handleSelectAgent = (agent) => {
    selectAgent(agent)
  }
  
  return (
    <>
      {/* Loading screen */}
      {loading && (
        <div className="loading">
          <div className="spinner" />
          <div>Loading Eliza Town...</div>
        </div>
      )}
      
      {/* 3D Scene */}
      <div className="canvasContainer">
        <Scene3D onSelectAgent={handleSelectAgent} />
      </div>
      
      {/* Info */}
      <div className="info">
        Click agent to inspect | Mouse: Rotate | Scroll: Zoom
      </div>
      
      {/* Branding */}
      <div className="branding">
        <div className="logo">E</div>
        <div className="text">Powered by <strong>ElizaOS</strong></div>
      </div>
      
      {/* UI Panels */}
      <div className="uiContainer">
        <AgentsPanel onSelectAgent={handleSelectAgent} />
        <TasksPanel />
        <ResultsPanel />
        <MessagesPanel />
        <TaskInput />
      </div>
      
      {/* Agent Modal */}
      <AgentModal />
    </>
  )
}

export default App
