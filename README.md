# Eliza Town

A 3D multi-agent orchestration visualization powered by [Eliza OS](https://github.com/elizaOS/eliza). Watch autonomous AI agents collaborate in a medieval town to complete software engineering tasks.

## Open Source


<img width="2400" height="1260" alt="image" src="https://github.com/user-attachments/assets/2cfadb49-47a2-489e-92a9-bb473930ed09" />


This project is **open source** under the MIT License. We welcome contributions from the community!

- [Contributing Guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [License](LICENSE)

## Features

- **3D Visualization**: Medieval town built with Three.js and KayKit assets
- **Autonomous Agents**: AI agents with distinct roles (planner, designer, coder, reviewer)
- **Hub-Based Navigation**: Agents travel between locations (town square, workshop, library, tavern)
- **Real-Time Updates**: WebSocket-powered live status and message updates
- **Task Orchestration**: Automatic task breakdown, assignment, and completion
- **Agent Customization**: Configure agent personalities, capabilities, and LLM models

## Tech Stack

- **Frontend**: Three.js, Vanilla JavaScript, WebSocket
- **Backend**: Node.js, Express
- **Database**: PostgreSQL
- **AI**: Claude API (Anthropic) - runs in simulation mode without API key
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
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/eliza_town

# Optional: Claude API for real AI responses (runs simulation without it)
ANTHROPIC_API_KEY=sk-ant-...

# Server
PORT=3000
NODE_ENV=development
```

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
GET  /api/agents           # List all agents
GET  /api/agents/:id       # Get agent details
PATCH /api/agents/:id      # Update agent settings

GET  /api/tasks            # List all tasks
POST /api/tasks            # Create new task
GET  /api/tasks/:id        # Get task details

GET  /api/messages         # Get recent messages
GET  /api/hubs             # List hub locations

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
