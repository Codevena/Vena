<p align="center">
  <img src="https://img.shields.io/badge/vena-v0.1.0-FF6B2B?style=for-the-badge" alt="Version" />
  <img src="https://img.shields.io/badge/license-MIT-FF9F1C?style=for-the-badge" alt="License" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-FF4500?style=for-the-badge" alt="Node" />
  <img src="https://img.shields.io/badge/typescript-ESM-FF6B2B?style=for-the-badge" alt="TypeScript" />
</p>

```
  ██╗   ██╗███████╗███╗   ██╗ █████╗
  ██║   ██║██╔════╝████╗  ██║██╔══██╗
  ██║   ██║█████╗  ██╔██╗ ██║███████║
  ╚██╗ ██╔╝██╔══╝  ██║╚██╗██║██╔══██║
   ╚████╔╝ ███████╗██║ ╚████║██║  ██║
    ╚═══╝  ╚══════╝╚═╝  ╚═══╝╚═╝  ╚═╝
```

<h3 align="center">Open Source AI Agent Platform</h3>

<p align="center">
  Knowledge graph memory · Multi-agent mesh · Voice · Browser automation · Google Workspace
</p>

---

## Why Vena?

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

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/Codevena/Vena/master/install.sh | bash
vena onboard
vena start
```

## Features

### Character System

5 built-in personalities compiled into system prompts via `SoulCompiler`:

- **Nova** — Direct peer, cuts through noise
- **Sage** — Patient teacher, explains everything
- **Spark** — Creative collaborator, explores ideas
- **Ghost** — Minimal signal, just the answer
- **Atlas** — Systems thinker, sees the big picture

```bash
vena chat --character ghost
```

### Semantic Memory

Knowledge graph backed by SQLite — not flat files.

- **KnowledgeGraph** — Entity and relationship storage with triple-based queries
- **EntityExtractor** — Extracts entities from conversation turns
- **SemanticIndex** — Embedding-based similarity search
- **ContextRanker** — Ranks recalled memories by relevance
- **MemoryConsolidator** — Compacts and merges knowledge over time

### Multi-Agent Mesh

Real mesh networking between agents — not simple routing.

- **MeshNetwork** — Capability-based message routing
- **MessageBus** — Pub/sub for inter-agent communication
- **Consultation** — Agent-to-agent knowledge queries
- **Delegation** — Task handoff between specialized agents

### Voice Pipeline

Full voice I/O with character-aware voice selection:

- **TTS** — ElevenLabs, OpenAI text-to-speech
- **STT** — Whisper, Deepgram speech-to-text
- **Calls** — Twilio phone call integration
- **VoiceConfigManager** — Maps characters to voice profiles

### Skills System

Extensible skill loading from SKILL.md files with security hardening:

- **SkillLoader** — Loads from bundled, managed, and workspace sources
- **SkillParser** — Validates name, length, content
- **SkillRegistry** — Registers and resolves skills by trigger
- **SkillInjector** — XML-escaped injection into system prompts

**Example skill**

An example skill is included at `skills/example/SKILL.md`.

```bash
vena skill install skills/example/SKILL.md
```

### Browser Automation

Playwright-powered browser control:

- **BrowserTool** — Navigate, click, type, screenshot
- **Shell** — Sandboxed command execution
- **Screenshot** — Visual page capture
- **Keyboard** — Input simulation

### Google Workspace

Full Google Workspace integration via OAuth:

- **Gmail** — Read, send, search emails
- **Calendar** — Events, scheduling
- **Drive** — File management
- **Docs** — Document creation and editing
- **Sheets** — Spreadsheet operations

### Security

Defense-in-depth via `ToolGuard`:

- **Trust levels** — `readonly`, `limited`, `full`
- **Path validation** — Blocks `.env`, `.ssh`, `../ traversal`
- **URL validation** — Blocks private IPs, non-http(s) schemes
- **Command validation** — Allowlist of safe shell commands
- **Env sanitization** — Strips sensitive vars before subprocess execution

### Channels

Multi-channel message delivery:

- **Telegram** — Via grammY
- **WhatsApp** — Via Baileys
- **HTTP** — REST API
- **WebSocket** — Real-time streaming
- **OpenAI-compatible** — Drop-in `/v1/chat/completions`

## Architecture

```
├── apps/cli/                  CLI entry point (@vena/cli)
│   ├── src/commands/          onboard, chat, start, config, skill, agent, network
│   ├── src/lib/runtime.ts     Config loading, provider factory
│   └── src/ui/terminal.ts     Orange theme, animations
├── packages/
│   ├── shared/                Types, Config (Zod), Logger, Errors, Characters
│   ├── providers/             Anthropic, OpenAI, Gemini, Ollama + OAuth
│   ├── core/                  AgentLoop, ToolExecutor, ToolGuard, SoulCompiler
│   ├── semantic-memory/       KnowledgeGraph, EntityExtractor, SemanticIndex
│   ├── channels/              Telegram (grammY), WhatsApp (Baileys)
│   ├── gateway/               Fastify HTTP + WebSocket + OpenAI-compat API
│   ├── skills/                SkillLoader, SkillParser, SkillRegistry
│   ├── computer/              Shell, Browser (Playwright), Screenshot
│   ├── voice/                 ElevenLabs TTS, Whisper STT, Twilio Calls
│   ├── integrations/          Gmail, Docs, Sheets, Calendar, Drive
│   └── agents/                MeshNetwork, MessageBus, Consultation, Delegation
```

### Message Flow

```
Channel (Telegram / WhatsApp / HTTP / WebSocket)
  → handleChannelMessage(InboundMessage, sendFn)
    → Voice? → VoiceMessagePipeline (STT transcription)
    → selectAgent → MeshNetwork.routeMessage()
    → AgentLoop.run(message, session)  [AsyncIterable<AgentEvent>]
      → LLM Provider.chat()  [AsyncIterable<StreamChunk>]
      → Tool execution (ToolGuard → ToolExecutor → tools)
    → MemoryManager.log() + MemoryEngine.ingest()
    → Voice reply? → VoiceMessagePipeline (TTS synthesis)
    → Channel.send(response)
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `vena onboard` | Interactive setup wizard (6 steps) |
| `vena chat` | Terminal chat with LLM streaming |
| `vena start` | Start the full platform |
| `vena config` | View and edit configuration |
| `vena skill` | Manage skills |
| `vena skill validate` | Validate SKILL.md files |
| `vena agent` | Manage agents |
| `vena network` | View mesh network status |

## API Reference

### REST

```
POST /api/message          Send a message
GET  /health               Health check
GET  /api/status           Platform status
GET  /api/sessions         Active sessions
GET  /api/agents           Registered agents
```

### OpenAI-Compatible

```
POST /v1/chat/completions  Chat completions (streaming + non-streaming)
```

Notes:
- You can pass `session_key` in the JSON body to keep a stable session.
- You can pass `user` to tag requests per user.

### WebSocket

```
ws://host:18789            Real-time chat
```

## Configuration

Config lives at `~/.vena/vena.json`. Created by `vena onboard`.

```jsonc
{
  "providers": {
    "anthropic": { "apiKey": "${ANTHROPIC_API_KEY}" }
  },
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "channels": {
    "telegram": { "enabled": false, "token": "" },
    "whatsapp": { "enabled": false }
  },
  "gateway": {
    "port": 18789,
    "auth": { "enabled": false },
    "rateLimit": { "enabled": true, "maxRequests": 60, "windowMs": 60000 }
  },
  "agents": {
    "registry": {
      "default": { "character": "nova", "provider": "anthropic" }
    }
  },
  "memory": { "provider": "daily-log" },
  "semanticMemory": { "enabled": false },
  "security": { "trustLevel": "limited" },
  "voice": { "ttsProvider": "elevenlabs", "sttProvider": "whisper" },
  "skills": { "enabled": true }
}
```

## Development

```bash
git clone https://github.com/Codevena/Vena.git
cd Vena
pnpm install
pnpm -r build
pnpm test
```

### Build Commands

```bash
pnpm install                    # Install all dependencies
pnpm -r build                   # Build all 12 packages
pnpm --filter @vena/cli build   # Build just CLI
pnpm test                       # Run all tests
```

### Testing

67+ unit tests across 8 test files via Vitest:

| Package | Tests | Coverage |
|---------|-------|----------|
| `@vena/core` — ToolGuard | 11 | Trust levels, tool/command validation, env sanitization |
| `@vena/core` — PathValidator | 9 | Traversal, blocked patterns, allowed roots |
| `@vena/core` — UrlValidator | 13 | Private IPs, protocol blocking, valid URLs |
| `@vena/core` — SoulCompiler | 9 | Character compilation, user profile, all 5 characters |
| `@vena/gateway` — Auth | 3 | Auth config structure |
| `@vena/gateway` — RateLimit | 7 | Window enforcement, burst, reset, WS limiting |
| `@vena/shared` — Characters | 8 | All characters exist, required fields, getCharacter |
| `@vena/skills` — Injector | 7 | XML escaping, prompt injection prevention |

## Providers

| Provider | Auth | Streaming |
|----------|------|-----------|
| Anthropic | API Key, OAuth, Bearer | Yes |
| OpenAI | API Key, OAuth, Bearer | Yes |
| Google Gemini | API Key, OAuth, Bearer | Yes |
| Ollama | None (local) | Yes |

## License

[MIT](LICENSE)

---

<p align="center">
  <sub>Built with <span style="color: #FF6B2B">&#9632;</span> by <a href="https://github.com/Codevena">@Codevena</a></sub>
</p>
