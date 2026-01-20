# Contributing to Eliza Town

Thank you for your interest in contributing to Eliza Town! This project is part of the Eliza OS ecosystem for building autonomous AI agent systems.

## Getting Started

1. **Fork the repository** and clone it locally
2. **Install dependencies**: `npm install`
3. **Set up the database**: PostgreSQL 14+
4. **Copy environment variables**: `cp .env.example .env` and configure
5. **Run the development server**: `npm start`

## Development Setup

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- A modern browser with WebGL support

### Environment Variables

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/eliza_town
ANTHROPIC_API_KEY=sk-ant-...  # Optional - runs in simulation mode without it
PORT=3000
```

## How to Contribute

### Reporting Bugs

- Check existing issues first
- Include browser/OS information
- Provide steps to reproduce
- Include console errors if applicable

### Suggesting Features

- Open an issue with the "enhancement" label
- Describe the use case
- Explain how it fits with Eliza OS

### Pull Requests

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make your changes
3. Test locally
4. Commit with clear messages
5. Push and open a PR

### Code Style

- Use ES6+ JavaScript
- Keep functions small and focused
- Comment complex logic
- Follow existing patterns in the codebase

## Project Structure

```
eliza-town/
├── index.html          # Three.js frontend
├── src/
│   ├── server.js       # Express server entry
│   ├── api/            # REST API routes
│   ├── agents/         # Agent configurations
│   ├── db/             # Database schema and queries
│   └── orchestration/  # Agent orchestration loop
├── assets/             # 3D models and textures
└── output/             # Generated task outputs
```

## Areas to Contribute

- **3D Assets**: New character models, buildings, animations
- **Agent Types**: New agent roles and capabilities
- **Orchestration**: Improved task distribution algorithms
- **UI/UX**: Better controls, mobile support, accessibility
- **Documentation**: Tutorials, examples, API docs
- **Testing**: Unit tests, integration tests

## Community

- Be respectful and inclusive
- Help newcomers get started
- Share knowledge and learnings

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
