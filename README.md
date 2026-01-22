# Eliza Town

A 3D multi-agent orchestration visualization powered by [Eliza OS](https://github.com/elizaOS/eliza). Watch autonomous AI agents collaborate in a medieval town to complete software engineering tasks with **real code execution**.

## Open Source


<img width="2400" height="1260" alt="image" src="https://github.com/user-attachments/assets/2cfadb49-47a2-489e-92a9-bb473930ed09" />


This project is **open source** under the MIT License. We welcome contributions from the community!

- [Contributing Guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [License](LICENSE)

## Features

- **3D Visualization**: Medieval town built with Three.js and KayKit assets
- **Autonomous Agents**: AI agents with distinct roles (planner, designer, coder, reviewer)
- **Real Code Execution**: Agents can read, write, edit files and run shell commands
- **E2B Sandbox Support**: Safe cloud sandboxes for public demos
- **Demo Mode**: Continuous automated building for showcases
- **Hub-Based Navigation**: Agents travel between locations (town square, workshop, library, tavern)
- **Real-Time Updates**: WebSocket-powered live status and message updates
- **Task Orchestration**: Official ElizaOS orchestrator with sub-agent execution
- **Agent Customization**: Configure agent personalities, capabilities, and LLM models

## Tech Stack

- **Frontend**: React + Three.js (React Three Fiber), Zustand
- **Backend**: Node.js, Express, ElizaOS Runtime
- **Database**: PostgreSQL (optional, in-memory supported)
- **AI**: Multiple LLM providers (Groq, Anthropic, OpenAI)
- **Code Execution**: ElizaOS plugin-code, plugin-shell, E2B sandbox
- **Assets**: KayKit Medieval Builder Pack

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Modern browser with WebGL

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/eliza-town.git
cd eliza-town

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your database credentials

# Create database
createdb eliza_town

# Start the server
npm start
```

### Environment Variables

```bash
# LLM Provider (choose one or more)
LLM_PROVIDER=groq  # groq, anthropic, or openai
GROQ_API_KEY=gsk_your_key
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Database (optional - uses in-memory without it)
DATABASE_URL=postgresql://user:password@localhost:5432/eliza_town

# Server
PORT=3000
NODE_ENV=development

# Code Execution (for real file operations)
CODER_ENABLED=true
SHELL_ENABLED=true
CODER_ALLOWED_DIRECTORY=/path/to/sandbox

# E2B Cloud Sandbox (for secure public demos)
USE_E2B=true
E2B_API_KEY=e2b_your_key

# Demo Mode
DEMO_MODE=true
```

## Running Modes

### Development Mode
```bash
npm run dev
```
Runs with hot-reload. Agents generate code but don't execute unless enabled.

### Demo Mode
```bash
npm run demo
# or
DEMO_MODE=true npm start
```
Agents continuously explore and build in a sandbox. Great for showcases.

### With Code Execution
```bash
CODER_ENABLED=true SHELL_ENABLED=true npm start
```
Agents can read/write files and run commands in the allowed directory.

### With E2B Cloud Sandbox
```bash
USE_E2B=true E2B_API_KEY=your_key npm start
```
Code execution happens in isolated cloud sandboxes (recommended for public demos).

## Project Structure

```
eliza-town/
├── index.html              # Main frontend (Three.js scene, UI, WebSocket)
├── src/
│   ├── server.js           # Express server with WebSocket
│   ├── api/
│   │   └── routes.js       # REST API endpoints
│   ├── agents/
│   │   ├── claude.js       # Claude API integration
│   │   └── config.js       # Agent configurations
│   ├── db/
│   │   ├── index.js        # Database queries
│   │   └── schema.sql      # PostgreSQL schema
│   └── orchestration/
│       ├── loop.js         # Main orchestration tick loop
│       └── state.js        # Agent state management
├── assets/
│   ├── models/             # Character GLB files
│   └── town/               # Building and prop models
└── output/                 # Generated task outputs (gitignored)
```

## How It Works

### Agent Roles

| Role | Description | Capabilities |
|------|-------------|--------------|
| **Planner** | Breaks down tasks into subtasks | task-breakdown, coordination, scheduling |
| **Designer** | Creates architecture and designs | architecture, ui-design, api-design |
| **Coder** | Implements solutions | javascript, typescript, python |
| **Reviewer** | Reviews and validates code | code-review, security, best-practices |

### Hub Locations

- **Town Square**: Central meeting point, announcements
- **Workshop**: Where coders build solutions
- **Library**: Research and design work
- **Tavern**: Casual discussions, reviews

### Orchestration Loop

1. Planner picks up pending tasks
2. Task is broken into subtasks (design, code, review)
3. Agents travel to appropriate hubs
4. Work is completed and files are generated
5. Results saved to `/output/task_X/`

## API Endpoints

```
# Agents
GET  /api/agents           # List all agents
GET  /api/agents/:id       # Get agent details
PATCH /api/agents/:id      # Update agent settings
POST /api/agents/:id/decide # Trigger agent decision

# Tasks (basic)
GET  /api/tasks            # List all tasks
POST /api/tasks            # Create new task
GET  /api/tasks/:id        # Get task details

# Orchestrated Tasks (with sub-agent execution)
GET  /api/orchestrated-tasks      # List orchestrated tasks
POST /api/orchestrated-tasks      # Create and auto-execute task
POST /api/orchestrated-tasks/:id/execute  # Execute a task

# Demo Mode
GET  /api/demo/status      # Get demo mode status
POST /api/demo/start       # Start demo mode
POST /api/demo/stop        # Stop demo mode

# Configuration
GET  /api/execution/config # Get current execution mode

# ElizaOS
GET  /api/eliza/runtimes   # Get runtime info
GET  /api/orchestration/debug  # Debug orchestration state
```

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Areas to Contribute

- New agent types and capabilities
- Additional 3D assets and animations
- Improved orchestration algorithms
- Mobile and accessibility support
- Documentation and tutorials

## Customization

### Create Your Own Agents

Add new agents by creating a config in `src/agents/configs.js`:

```javascript
export const agentConfigs = {
  // Your custom agent
  researcher: {
    name: 'Researcher',
    hub: 'library',
    color: '#9966ff',
    model: 'claude-sonnet-4-20250514',
    system: `You are a Research agent. You find information, 
             verify facts, and provide sources for the team.`,
    personality: {
      traits: ['curious', 'thorough', 'analytical'],
      voice: 'academic but approachable'
    }
  },
  
  // Add as many as you want
  writer: { ... },
  translator: { ... },
  analyst: { ... }
}
```

Then add the agent to your database:

```sql
INSERT INTO agents (name, type, system_prompt, current_hub, color) 
VALUES ('Researcher', 'researcher', '...', 'library', '#9966ff');
```

### Add Custom Hubs

Create new workstations for your agents in `src/db/schema.sql`:

```sql
INSERT INTO hubs (id, name, description, type, position_x, position_y) VALUES
  ('library', 'Library', 'Research and reference', 'work', 7, 0),
  ('workshop', 'Workshop', 'Building and prototyping', 'work', -7, 0),
  ('garden', 'Garden', 'Creative brainstorming', 'social', 0, 7);
```
### Bring Your Own Assets

Drop your 3D models into `public/models/`:

```
public/models/
├── agents/
│   ├── researcher.glb      # Your custom character
│   ├── writer.glb
│   └── analyst.glb
├── hubs/
│   ├── library.glb         # Custom building
│   ├── workshop.glb
│   └── garden.glb
└── props/
    ├── desk.glb
    ├── computer.glb
    └── bookshelf.glb
```

**Supported formats**: GLB, GLTF

**Recommended sources**:
- [Kay Kit](https://kaylousberg.itch.io/) — Free low poly characters (CC0)
- [Sketchfab](https://sketchfab.com/) — Search "chibi", "low poly", "stylized"
- [Mixamo](https://mixamo.com/) — Free rigging and animations
- [Meshy](https://meshy.ai/) — AI generated 3D models
- [Poly Pizza](https://poly.pizza/) — Free low poly assets

**Animation requirements**:
Each character model should include these animation clips:
- `idle` — Breathing/standing
- `walk` — Walking cycle
- `work` — Typing/working gesture

## Part of Eliza OS

Eliza Town is built on [Eliza OS](https://github.com/elizaOS/eliza), an open-source framework for building autonomous AI agent systems. Check out the main project for more tools and examples.

## License

MIT License - see [LICENSE](LICENSE) for details.

---

Built with love by the Eliza Town community
