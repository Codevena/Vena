# Vena Documentation

**Open Source AI Agent Platform**

Vena is a production-ready AI agent platform built as a TypeScript monorepo. It features knowledge graph memory, multi-agent mesh networking, voice I/O, browser automation, and Google Workspace integration.

## Table of Contents

### Getting Started
- [Getting Started](./getting-started.md) - Installation, onboarding, and first steps
- [Configuration](./configuration.md) - Complete config reference for `~/.vena/vena.json`

### Core Concepts
- [Agents](./agents.md) - Agent system, characters, mesh network, trust levels
- [Memory](./memory.md) - Memory architecture, knowledge graph, semantic search
- [Tools](./tools.md) - Available tools and trust level requirements
- [Skills](./skills.md) - Custom skill system and SKILL.md format
- [Security](./security.md) - Security model and ToolGuard enforcement

### Integrations
- [Providers](./providers.md) - LLM provider setup (Anthropic, OpenAI, Gemini, Ollama)
- [Channels](./channels.md) - Message channels (Telegram, WhatsApp, Slack, Discord)
- [Voice](./voice.md) - Voice I/O with TTS, STT, and phone calls
- [API](./api.md) - HTTP API, WebSocket, and OpenAI-compatible endpoints

## What is Vena?

Vena is a next-generation AI agent platform that goes beyond simple chatbots. It provides:

**Knowledge Graph Memory** - Store and recall information using a SQLite-backed knowledge graph with entity extraction, relationship mapping, and semantic search. Not just flat Markdown files.

**Multi-Agent Mesh** - Run multiple specialized agents that collaborate through capability-based routing, consultation, and delegation. Real mesh networking, not simple routing.

**Character System** - 5 built-in agent personalities (Nova, Sage, Spark, Ghost, Atlas) compiled into system prompts via `SoulCompiler`. Each character has distinct communication styles and behaviors.

**Voice Pipeline** - Full voice I/O with TTS (ElevenLabs, OpenAI), STT (Whisper, Deepgram), and phone call integration via Twilio. Character-aware voice selection.

**Browser Automation** - Playwright-powered browser control with navigation, interaction, and screenshot capabilities.

**Google Workspace** - Native integration with Gmail, Calendar, Drive, Docs, and Sheets via OAuth.

**Security First** - Defense-in-depth via `ToolGuard` with trust levels, path validation, URL validation, command allowlisting, and environment sanitization.

## Comparison with Alternatives

| Feature | Vena | OpenClaw |
|---------|------|----------|
| **Memory** | Knowledge Graph (SQLite) | Flat Markdown |
| **Multi-Agent** | Real mesh network | Routing only |
| **Auth** | OAuth + API Key + Bearer | API Key only |
| **Characters** | 5 built-in personalities | None |
| **Voice** | TTS + STT + Phone Calls | None |
| **Google Workspace** | Gmail, Calendar, Drive, Docs, Sheets | None |
| **Browser** | Playwright automation | None |
| **Skills** | SKILL.md with XML injection | None |
| **Channels** | Telegram, WhatsApp, HTTP, WS | REST only |

## Quick Links

### Installation
```bash
curl -fsSL https://raw.githubusercontent.com/Codevena/Vena/master/install.sh | bash
vena onboard
vena start
```

### CLI Commands
- `vena onboard` - Interactive 6-step setup wizard
- `vena chat` - Terminal chat with streaming responses
- `vena start` - Start the full platform
- `vena config` - View and edit configuration
- `vena skill` - Manage skills
- `vena agent` - Manage agents
- `vena network` - View mesh network status

### API Endpoints
- `POST /api/message` - Send messages
- `GET /health` - Health check
- `GET /api/status` - Platform status
- `ws://host:18789` - WebSocket chat
- `POST /v1/chat/completions` - OpenAI-compatible endpoint

## Architecture

Vena is built as a TypeScript monorepo with 12 packages:

- **@vena/cli** - CLI entry point with commands
- **@vena/shared** - Types, config schema, logger, characters
- **@vena/providers** - LLM providers (Anthropic, OpenAI, Gemini, Ollama)
- **@vena/core** - AgentLoop, ToolExecutor, ToolGuard, SoulCompiler
- **@vena/semantic-memory** - KnowledgeGraph, EntityExtractor, SemanticIndex
- **@vena/channels** - Telegram, WhatsApp channels
- **@vena/gateway** - HTTP server, WebSocket, OpenAI-compat API
- **@vena/skills** - Skill loader, parser, registry, injector
- **@vena/computer** - Shell, Browser (Playwright), Screenshot
- **@vena/voice** - TTS, STT, phone call integration
- **@vena/integrations** - Google Workspace (Gmail, Drive, Docs, Sheets, Calendar)
- **@vena/agents** - MeshNetwork, MessageBus, Consultation, Delegation

## Development

```bash
git clone https://github.com/Codevena/Vena.git
cd Vena
pnpm install
pnpm -r build
pnpm test
```

## License

[MIT](https://github.com/Codevena/Vena/blob/master/LICENSE)

---

**Need help?** Check the guides in the navigation above or open an issue on [GitHub](https://github.com/Codevena/Vena/issues).
