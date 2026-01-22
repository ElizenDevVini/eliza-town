import { useRef, useEffect, useState, Suspense } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { 
  useGameStore, 
  useBubbleStore, 
  HUBS, 
  WAYPOINTS, 
  normalizeAgentId 
} from '../stores/gameStore'

// Agent type to model mapping
const AGENT_MODELS = {
  planner: 'Witch',
  designer: 'BlackKnight',
  coder: 'Protagonist_A',
  reviewer: 'Tiefling',
}

// Agent type colors
const TYPE_COLORS = {
  planner: '#c084fc',
  designer: '#f472b6',
  coder: '#60a5fa',
  reviewer: '#4ade80',
}

// Movement speed (units per second)
const MOVE_SPEED = 4

// Town Asset Component
function TownAsset({ category, name, position, scale = 3, rotation = 0 }) {
  const [model, setModel] = useState(null)
  
  useEffect(() => {
    const assetPath = `/assets/town/${category}/${name}.gltf`
    const loader = new GLTFLoader()
    loader.load(
      assetPath,
      (gltf) => {
        const scene = gltf.scene.clone()
        scene.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true
            child.receiveShadow = true
          }
        })
        setModel(scene)
      },
      undefined,
      (error) => console.warn(`[Scene3D] Failed to load town asset ${assetPath}:`, error)
    )
  }, [category, name])
  
  if (!model) return null
  
  return (
    <primitive 
      object={model} 
      position={[position.x, position.y || 0, position.z]} 
      scale={[scale, scale, scale]}
      rotation={[0, rotation, 0]}
    />
  )
}

/**
 * Agent Character with smooth movement interpolation
 * Position is managed in the Zustand store for consistency
 */
function AgentCharacter({ agent, onSelect }) {
  const groupRef = useRef()
  const [model, setModel] = useState(null)
  
  // Get movement state from store
  const movement = useGameStore((s) => s.getAgentMovement(agent.id))
  const updateAgentPosition = useGameStore((s) => s.updateAgentPosition)
  
  // Get bubble for this agent
  const normalizedId = normalizeAgentId(agent.id)
  const bubble = useBubbleStore((s) => s.bubbles.get(normalizedId))
  
  // Load agent model
  useEffect(() => {
    const modelName = AGENT_MODELS[agent.type] || 'Protagonist_A'
    const modelPath = `/assets/models/${modelName}.glb`
    
    console.log(`[Scene3D] Loading model for ${agent.name}: ${modelPath}`)
    
    const loader = new GLTFLoader()
    loader.load(
      modelPath,
      (gltf) => {
        console.log(`[Scene3D] Model loaded for ${agent.name}:`, gltf)
        const scene = gltf.scene.clone()
        scene.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true
            child.receiveShadow = true
          }
        })
        setModel(scene)
      },
      (progress) => {
        if (progress.total > 0) {
          console.log(`[Scene3D] Loading ${agent.name}: ${Math.round((progress.loaded / progress.total) * 100)}%`)
        }
      },
      (error) => {
        console.error(`[Scene3D] Failed to load model ${modelName} for ${agent.name}:`, error)
      }
    )
  }, [agent.type, agent.name])
  
  // Animate movement every frame
  useFrame((state, delta) => {
    if (!groupRef.current || !movement) return
    
    const { x, z, path, pathIndex, isMoving, targetHub } = movement
    
    // Get current target waypoint
    let targetPos
    if (isMoving && path.length > 0 && pathIndex < path.length) {
      const waypointName = path[pathIndex]
      targetPos = WAYPOINTS[waypointName] || HUBS[targetHub] || { x: 0, z: 0 }
    } else {
      // Not moving - stay at current hub
      targetPos = HUBS[targetHub] || { x: 0, z: 0 }
    }
    
    // Calculate direction and distance
    const dx = targetPos.x - x
    const dz = targetPos.z - z
    const dist = Math.sqrt(dx * dx + dz * dz)
    
    // Arrival threshold
    const ARRIVAL_THRESHOLD = 0.5
    
    if (dist > ARRIVAL_THRESHOLD) {
      // Move toward target
      const speed = MOVE_SPEED * delta
      const moveAmount = Math.min(speed, dist)
      const newX = x + (dx / dist) * moveAmount
      const newZ = z + (dz / dist) * moveAmount
      
      // Update position in store
      updateAgentPosition(agent.id, newX, newZ, false)
      
      // Update visual position
      groupRef.current.position.x = newX
      groupRef.current.position.z = newZ
      
      // Walking bob animation
      groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 10) * 0.015
      
      // Face movement direction
      groupRef.current.rotation.y = Math.atan2(dx, dz)
    } else if (isMoving) {
      // Arrived at waypoint - signal to move to next
      updateAgentPosition(agent.id, targetPos.x, targetPos.z, true)
      
      // Snap to exact position
      groupRef.current.position.x = targetPos.x
      groupRef.current.position.z = targetPos.z
    } else {
      // Idle at destination
      groupRef.current.position.x = x
      groupRef.current.position.z = z
      
      // Idle animation based on status
      groupRef.current.position.y = agent.status === 'working' 
        ? Math.sin(state.clock.elapsedTime * 4) * 0.05 
        : 0
    }
  })
  
  // Get initial position from movement state or hub
  const initialPos = movement 
    ? { x: movement.x, z: movement.z }
    : HUBS[agent.current_hub] || HUBS.town_square
  
  return (
    <group 
      ref={groupRef} 
      position={[initialPos.x, 0, initialPos.z]}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(agent)
      }}
    >
      {/* Agent model or fallback */}
      {model ? (
        <primitive object={model} scale={[1, 1, 1]} />
      ) : (
        <mesh castShadow>
          <capsuleGeometry args={[0.3, 1, 4, 8]} />
          <meshStandardMaterial color={TYPE_COLORS[agent.type] || '#ffffff'} />
        </mesh>
      )}
      
      {/* Name label */}
      <Html position={[0, 2.5, 0]} center distanceFactor={10}>
        <div style={{
          background: 'rgba(0,0,0,0.7)',
          color: '#f4e4c1',
          padding: '3px 8px',
          borderRadius: '10px',
          fontSize: '11px',
          fontFamily: 'Cinzel, serif',
          whiteSpace: 'nowrap',
          border: agent.status === 'working' ? '1px solid #8b6914' : 'none',
        }}>
          {agent.name}
          {agent.status === 'working' && <span style={{ color: '#c9a959', marginLeft: 4 }}>⚡</span>}
        </div>
      </Html>
      
      {/* Speech bubble */}
      {bubble && (
        <Html position={[0, 3.5, 0]} center distanceFactor={8}>
          <div style={{
            maxWidth: '200px',
            padding: '10px 14px',
            background: bubble.type === 'thought' 
              ? 'rgba(40, 30, 20, 0.9)' 
              : 'linear-gradient(180deg, #4a3728, #3d2d1f)',
            border: bubble.type === 'thought' ? '1px solid #6b5a3e' : '2px solid #c9a959',
            borderRadius: bubble.type === 'thought' ? '16px' : '12px',
            color: bubble.type === 'thought' ? '#b8a88a' : '#f4e4c1',
            fontFamily: 'Crimson Text, serif',
            fontSize: bubble.type === 'thought' ? '11px' : '13px',
            fontStyle: bubble.type === 'thought' ? 'italic' : 'normal',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}>
            <div style={{ 
              fontFamily: 'Cinzel, serif', 
              fontSize: '11px', 
              color: '#c9a959',
              marginBottom: 4,
            }}>
              {agent.name}
            </div>
            {bubble.text}
          </div>
        </Html>
      )}
      
      {/* Working glow */}
      {agent.status === 'working' && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
          <ringGeometry args={[0.8, 1.2, 32]} />
          <meshBasicMaterial 
            color={TYPE_COLORS[agent.type] || '#ffffff'} 
            transparent 
            opacity={0.4} 
            side={THREE.DoubleSide} 
          />
        </mesh>
      )}
    </group>
  )
}

// Hub marker
function HubMarker({ position, color, name }) {
  return (
    <group position={[position.x, 0.02, position.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.5, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.1, 0.1, 0.5, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Html position={[0, 0.8, 0]} center>
        <div style={{
          background: 'rgba(0,0,0,0.6)',
          color: '#f4e4c1',
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '9px',
          fontFamily: 'Cinzel, serif',
          whiteSpace: 'nowrap',
        }}>
          {name}
        </div>
      </Html>
    </group>
  )
}

// Town Builder - creates the 3D environment
function TownBuilder() {
  const S = 3 // Scale factor
  
  return (
    <>
      {/* Ground tiles - simplified grid */}
      {Array.from({ length: 17 }, (_, xi) => xi - 8).map(x => 
        Array.from({ length: 17 }, (_, zi) => zi - 8).map(z => {
          const hexW = 1.73 * S
          const hexH = 1.5 * S
          const offX = z % 2 === 0 ? 0 : hexW / 2
          const px = x * hexW + offX
          const pz = z * hexH
          
          const isMainRoad = (Math.abs(x) <= 1 && Math.abs(z) <= 8) || (Math.abs(z) <= 1 && Math.abs(x) <= 8)
          
          return (
            <TownAsset 
              key={`tile-${x}-${z}`}
              category="tiles"
              name={isMainRoad ? 'hex_road_A' : 'hex_grass'}
              position={{ x: px, y: isMainRoad ? 0.01 : 0, z: pz }}
              scale={S}
            />
          )
        })
      )}
      
      {/* Central Plaza */}
      <TownAsset category="buildings" name="building_scaffolding" position={{ x: 0, y: 0, z: 0 }} scale={S * 2} />
      <TownAsset category="props" name="flag_blue" position={{ x: -4, y: 0, z: -4 }} scale={S * 1.5} />
      <TownAsset category="props" name="flag_red" position={{ x: 4, y: 0, z: -4 }} scale={S * 1.5} />
      <TownAsset category="props" name="flag_green" position={{ x: -4, y: 0, z: 4 }} scale={S * 1.5} />
      <TownAsset category="props" name="flag_yellow" position={{ x: 4, y: 0, z: 4 }} scale={S * 1.5} />
      
      {/* Northwest - Planning Room */}
      <TownAsset category="buildings" name="building_stage_A" position={{ x: -18, y: 0, z: -15 }} scale={S * 1.3} rotation={Math.PI/4} />
      <TownAsset category="buildings" name="building_stage_B" position={{ x: -24, y: 0, z: -12 }} scale={S * 1.2} rotation={Math.PI/3} />
      <TownAsset category="props" name="barrel" position={{ x: -16, y: 0, z: -13 }} scale={S} />
      <TownAsset category="props" name="barrel" position={{ x: -18, y: 0, z: -12 }} scale={S} />
      
      {/* Northeast - Design Studio */}
      <TownAsset category="buildings" name="building_stage_A" position={{ x: 18, y: 0, z: -15 }} scale={S * 1.3} rotation={-Math.PI/4} />
      <TownAsset category="buildings" name="building_stage_B" position={{ x: 24, y: 0, z: -12 }} scale={S * 1.2} rotation={-Math.PI/3} />
      <TownAsset category="props" name="crate_A_big" position={{ x: 20, y: 0, z: -15 }} scale={S} />
      <TownAsset category="props" name="tent" position={{ x: 23, y: 0, z: -18 }} scale={S * 1.2} rotation={-Math.PI/4} />
      
      {/* Southwest - Coding Desk */}
      <TownAsset category="buildings" name="building_stage_A" position={{ x: -18, y: 0, z: 15 }} scale={S * 1.2} rotation={Math.PI * 0.75} />
      <TownAsset category="buildings" name="building_stage_C" position={{ x: -21, y: 0, z: 21 }} scale={S * 1.3} rotation={Math.PI * 0.8} />
      <TownAsset category="props" name="wheelbarrow" position={{ x: -20, y: 0, z: 12 }} scale={S} rotation={Math.PI/3} />
      
      {/* Southeast - Review Station */}
      <TownAsset category="buildings" name="building_stage_A" position={{ x: 18, y: 0, z: 15 }} scale={S * 1.2} rotation={-Math.PI * 0.75} />
      <TownAsset category="buildings" name="building_stage_C" position={{ x: 21, y: 0, z: 21 }} scale={S * 1.3} rotation={-Math.PI * 0.8} />
      <TownAsset category="props" name="target" position={{ x: 28, y: 0, z: 12 }} scale={S} />
      <TownAsset category="props" name="target" position={{ x: 28, y: 0, z: 18 }} scale={S} />
      
      {/* North - Deploy Station */}
      <TownAsset category="buildings" name="building_grain" position={{ x: 0, y: 0, z: -25 }} scale={S * 1.2} />
      
      {/* Walls */}
      {Array.from({ length: 11 }, (_, i) => i - 5).map(i => (
        <group key={`walls-${i}`}>
          <TownAsset category="buildings" name="wall_straight" position={{ x: i * 7.5, y: 0, z: -36 }} scale={S} rotation={0} />
          <TownAsset category="buildings" name="wall_straight" position={{ x: i * 7.5, y: 0, z: 36 }} scale={S} rotation={Math.PI} />
          <TownAsset category="buildings" name="wall_straight" position={{ x: -36, y: 0, z: i * 7.5 }} scale={S} rotation={-Math.PI/2} />
          <TownAsset category="buildings" name="wall_straight" position={{ x: 36, y: 0, z: i * 7.5 }} scale={S} rotation={Math.PI/2} />
        </group>
      ))}
      
      {/* Corner towers */}
      <TownAsset category="buildings" name="wall_corner_A_outside" position={{ x: -36, y: 0, z: -36 }} scale={S * 1.4} rotation={0} />
      <TownAsset category="buildings" name="wall_corner_A_outside" position={{ x: 36, y: 0, z: -36 }} scale={S * 1.4} rotation={Math.PI/2} />
      <TownAsset category="buildings" name="wall_corner_A_outside" position={{ x: 36, y: 0, z: 36 }} scale={S * 1.4} rotation={Math.PI} />
      <TownAsset category="buildings" name="wall_corner_A_outside" position={{ x: -36, y: 0, z: 36 }} scale={S * 1.4} rotation={-Math.PI/2} />
      
      {/* Gates */}
      <TownAsset category="buildings" name="wall_straight_gate" position={{ x: 0, y: 0, z: -36 }} scale={S * 1.3} rotation={0} />
      <TownAsset category="buildings" name="wall_straight_gate" position={{ x: 0, y: 0, z: 36 }} scale={S * 1.3} rotation={Math.PI} />
      <TownAsset category="buildings" name="wall_straight_gate" position={{ x: -36, y: 0, z: 0 }} scale={S * 1.3} rotation={-Math.PI/2} />
      <TownAsset category="buildings" name="wall_straight_gate" position={{ x: 36, y: 0, z: 0 }} scale={S * 1.3} rotation={Math.PI/2} />
      
      {/* Nature - Trees around the perimeter */}
      <TownAsset category="nature" name="tree_single_A" position={{ x: -28, y: 0, z: -28 }} scale={S * 1.2} />
      <TownAsset category="nature" name="tree_single_B" position={{ x: 28, y: 0, z: -28 }} scale={S * 1.2} />
      <TownAsset category="nature" name="tree_single_A" position={{ x: -28, y: 0, z: 28 }} scale={S * 1.2} />
      <TownAsset category="nature" name="tree_single_B" position={{ x: 28, y: 0, z: 28 }} scale={S * 1.2} />
    </>
  )
}

// Scene contents
function SceneContents({ onSelectAgent }) {
  const agents = useGameStore((s) => s.agents)
  
  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.5} color="#fff5e6" />
      <directionalLight 
        position={[30, 40, 20]} 
        intensity={1.5} 
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.5}
        shadow-camera-far={200}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
      />
      <directionalLight position={[-20, 10, -20]} intensity={0.3} color="#8ecae6" />
      
      {/* Ground plane (fallback if tiles don't load) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#4a7c4e" roughness={0.9} />
      </mesh>
      
      {/* Town buildings and decorations */}
      <TownBuilder />
      
      {/* Hub markers */}
      <HubMarker position={HUBS.town_square} color="#c9a959" name="Town Square" />
      <HubMarker position={HUBS.planning_room} color="#c084fc" name="Planning" />
      <HubMarker position={HUBS.design_studio} color="#f472b6" name="Design" />
      <HubMarker position={HUBS.coding_desk} color="#60a5fa" name="Coding" />
      <HubMarker position={HUBS.review_station} color="#4ade80" name="Review" />
      <HubMarker position={HUBS.deploy_station} color="#fbbf24" name="Deploy" />
      
      {/* Agents */}
      {agents.map((agent) => (
        <AgentCharacter 
          key={normalizeAgentId(agent.id)} 
          agent={agent} 
          onSelect={onSelectAgent}
        />
      ))}
      
      {/* Camera controls */}
      <OrbitControls 
        enableDamping
        dampingFactor={0.05}
        maxPolarAngle={Math.PI / 2.1}
        minDistance={5}
        maxDistance={100}
        target={[0, 0, 0]}
      />
    </>
  )
}

// Main Scene3D component
export function Scene3D({ onSelectAgent }) {
  // Clear expired bubbles periodically
  const clearExpired = useBubbleStore((s) => s.clearExpired)
  
  useEffect(() => {
    const interval = setInterval(clearExpired, 1000)
    return () => clearInterval(interval)
  }, [clearExpired])
  
  return (
    <Canvas
      shadows
      camera={{ position: [60, 45, 60], fov: 60, near: 0.1, far: 2000 }}
      style={{ background: '#7EC8E3' }}
    >
      <fog attach="fog" args={['#7EC8E3', 50, 200]} />
      <Suspense fallback={null}>
        <SceneContents onSelectAgent={onSelectAgent} />
      </Suspense>
    </Canvas>
  )
}
