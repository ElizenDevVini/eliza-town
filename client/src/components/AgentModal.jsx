import { useState, useEffect } from 'react'
import { useGameStore } from '../stores/gameStore'
import { updateAgent, triggerAgentDecision } from '../services/api'
import styles from '../styles/AgentModal.module.css'

const HUBS = {
  town_square: 'Town Square',
  planning_room: 'Planning Room',
  design_studio: 'Design Studio',
  coding_desk: 'Coding Desk',
  review_station: 'Review Station',
  deploy_station: 'Deploy Station',
}

export function AgentModal() {
  const selectedAgent = useGameStore((s) => s.selectedAgent)
  const clearSelectedAgent = useGameStore((s) => s.clearSelectedAgent)
  
  const [activeTab, setActiveTab] = useState('info')
  const [editName, setEditName] = useState('')
  const [editType, setEditType] = useState('')
  const [editPersonality, setEditPersonality] = useState('')
  const [editCapabilities, setEditCapabilities] = useState('')
  const [jsonEditor, setJsonEditor] = useState('')
  const [saving, setSaving] = useState(false)
  
  // Populate edit fields when agent changes
  useEffect(() => {
    if (selectedAgent) {
      setEditName(selectedAgent.name || '')
      setEditType(selectedAgent.type || '')
      setEditPersonality(selectedAgent.personality || '')
      setEditCapabilities((selectedAgent.capabilities || []).join(', '))
      setJsonEditor(JSON.stringify(selectedAgent, null, 2))
      setActiveTab('info')
    }
  }, [selectedAgent])
  
  if (!selectedAgent) return null
  
  const handleClose = () => {
    clearSelectedAgent()
  }
  
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) handleClose()
  }
  
  const handleSave = async () => {
    setSaving(true)
    try {
      await updateAgent(selectedAgent.id, {
        name: editName,
        type: editType,
        personality: editPersonality,
        capabilities: editCapabilities.split(',').map((c) => c.trim()).filter(Boolean),
      })
      alert('Agent updated!')
    } catch (error) {
      console.error('Failed to update agent:', error)
      alert('Failed to update agent')
    } finally {
      setSaving(false)
    }
  }
  
  const handleCopyJson = () => {
    navigator.clipboard.writeText(jsonEditor)
    alert('JSON copied to clipboard!')
  }
  
  const handleApplyJson = async () => {
    try {
      const parsed = JSON.parse(jsonEditor)
      await updateAgent(parsed.id, parsed)
      alert('Agent updated from JSON!')
    } catch (error) {
      alert('Invalid JSON: ' + error.message)
    }
  }
  
  const handleTriggerDecision = async () => {
    try {
      const result = await triggerAgentDecision(selectedAgent.id, 'What would you like to do next?')
      console.log('Decision result:', result)
      alert(`Agent responded: ${result?.text || 'No response'}`)
    } catch (error) {
      console.error('Failed to trigger decision:', error)
    }
  }
  
  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2>{selectedAgent.name}</h2>
          <button className={styles.closeButton} onClick={handleClose}>&times;</button>
        </div>
        
        <div className={styles.body}>
          {/* Character section */}
          <div className={styles.characterSection}>
            <div className={styles.characterPreview}>
              <div className={styles.placeholder}>
                {selectedAgent.name?.charAt(0) || '?'}
              </div>
            </div>
            <div className={styles.nameBadge}>{selectedAgent.name}</div>
            <div className={styles.role}>{selectedAgent.type?.toUpperCase()}</div>
            <button className={styles.triggerButton} onClick={handleTriggerDecision}>
              ⚡ Trigger Decision
            </button>
          </div>
          
          {/* Details section */}
          <div className={styles.detailsSection}>
            <div className={styles.tabs}>
              <button 
                className={`${styles.tab} ${activeTab === 'info' ? styles.active : ''}`}
                onClick={() => setActiveTab('info')}
              >
                Info
              </button>
              <button 
                className={`${styles.tab} ${activeTab === 'customize' ? styles.active : ''}`}
                onClick={() => setActiveTab('customize')}
              >
                Customize
              </button>
              <button 
                className={`${styles.tab} ${activeTab === 'json' ? styles.active : ''}`}
                onClick={() => setActiveTab('json')}
              >
                JSON
              </button>
            </div>
            
            <div className={styles.tabContent}>
              {/* Info Tab */}
              {activeTab === 'info' && (
                <div className={styles.infoGrid}>
                  <div className={styles.infoItem}>
                    <div className={styles.infoLabel}>Status</div>
                    <div className={styles.infoValue}>{selectedAgent.status || 'idle'}</div>
                  </div>
                  <div className={styles.infoItem}>
                    <div className={styles.infoLabel}>Location</div>
                    <div className={styles.infoValue}>{HUBS[selectedAgent.current_hub] || 'Town Square'}</div>
                  </div>
                  <div className={styles.infoItem}>
                    <div className={styles.infoLabel}>Current Task</div>
                    <div className={styles.infoValue}>{selectedAgent.doing || 'None'}</div>
                  </div>
                  <div className={styles.infoItem}>
                    <div className={styles.infoLabel}>Model</div>
                    <div className={styles.infoValue}>{selectedAgent.model_id || 'default'}</div>
                  </div>
                  <div className={`${styles.infoItem} ${styles.full}`}>
                    <div className={styles.infoLabel}>Personality</div>
                    <div className={styles.infoValue}>{selectedAgent.personality || 'No personality set'}</div>
                  </div>
                  <div className={`${styles.infoItem} ${styles.full}`}>
                    <div className={styles.infoLabel}>Capabilities</div>
                    <div className={styles.capabilities}>
                      {(selectedAgent.capabilities || []).map((cap, idx) => (
                        <span key={idx} className={styles.capabilityTag}>{cap}</span>
                      ))}
                      {(!selectedAgent.capabilities || selectedAgent.capabilities.length === 0) && (
                        <span className={styles.noCapabilities}>No capabilities set</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
              
              {/* Customize Tab */}
              {activeTab === 'customize' && (
                <div className={styles.customizeForm}>
                  <div className={styles.formGroup}>
                    <label>Agent Name</label>
                    <input 
                      type="text" 
                      value={editName} 
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label>Role Type</label>
                    <select value={editType} onChange={(e) => setEditType(e.target.value)}>
                      <option value="planner">Planner - Breaks down tasks</option>
                      <option value="designer">Designer - Architecture & UI</option>
                      <option value="coder">Coder - Writes code</option>
                      <option value="reviewer">Reviewer - Reviews code</option>
                    </select>
                  </div>
                  <div className={styles.formGroup}>
                    <label>Personality</label>
                    <textarea 
                      value={editPersonality} 
                      onChange={(e) => setEditPersonality(e.target.value)}
                      placeholder="Describe the agent's personality..."
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label>Capabilities (comma-separated)</label>
                    <input 
                      type="text" 
                      value={editCapabilities} 
                      onChange={(e) => setEditCapabilities(e.target.value)}
                      placeholder="e.g., javascript, python, architecture"
                    />
                  </div>
                  <button 
                    className={styles.saveButton} 
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              )}
              
              {/* JSON Tab */}
              {activeTab === 'json' && (
                <div className={styles.jsonTab}>
                  <textarea 
                    className={styles.jsonEditor}
                    value={jsonEditor}
                    onChange={(e) => setJsonEditor(e.target.value)}
                    spellCheck={false}
                  />
                  <div className={styles.jsonActions}>
                    <button className={styles.jsonButton} onClick={handleCopyJson}>Copy JSON</button>
                    <button className={`${styles.jsonButton} ${styles.apply}`} onClick={handleApplyJson}>Apply Changes</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
