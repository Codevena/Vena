# Vena - AI Agent Platform

## Project Context

Vena is an open-source AI agent platform built as a TypeScript monorepo (pnpm workspaces). It's a competitor/alternative to OpenClaw, with key advantages in memory (knowledge graph vs flat Markdown), multi-agent (real mesh vs routing), and auth (OAuth + API key vs API key only).

**Owner:** Markus (@Codevena)
**Repo:** https://github.com/Codevena/Vena.git
**Branch:** `master`
**Size:** 97 TypeScript source files, ~12,700 lines, 12 packages

## Rules

- Never write "Claude" or "powered by Claude" in commit messages
- Always continue working without asking unnecessary questions
- Orange theme: primary `#FF6B2B`, gold `#FF9F1C`, deep `#FF4500`
- All packages must build clean (`pnpm -r build` with zero errors)
- Use `pnpm` (not npm/yarn)
- ESM only (type: "module" in all package.json)
- Commit messages should describe the "why", not the "what"

## Monorepo Structure

```
/Users/markus/Developer/vena/
├── apps/cli/                  CLI entry point (@vena/cli)
│   ├── src/commands/          onboard.ts, chat.ts, start.ts, config.ts, skill.ts, agent.ts, network.ts
│   ├── src/lib/runtime.ts     Shared: loadConfig(), createProvider(), paths
│   └── src/ui/terminal.ts     Orange theme, animations, boxed(), spinnerLine()
├── packages/
│   ├── shared/                @vena/shared - Types, Config (Zod), Logger (Pino), Errors
│   ├── providers/             @vena/providers - Anthropic, OpenAI, Gemini, Ollama + auth.ts (OAuth)
│   ├── core/                  @vena/core - AgentLoop, ToolExecutor, MemoryManager, Compaction
│   ├── semantic-memory/       @vena/semantic-memory - KnowledgeGraph, EntityExtractor, SemanticIndex, ContextRanker, MemoryConsolidator, MemoryEngine
│   ├── channels/              @vena/channels - TelegramChannel (grammY), WhatsAppChannel (Baileys)
│   ├── gateway/               @vena/gateway - GatewayServer (Fastify), MessageRouter, LaneQueue, SessionStore, OpenAI-compat API
│   ├── skills/                @vena/skills - SkillLoader, SkillParser, SkillRegistry
│   ├── computer/              @vena/computer - Shell, Browser (Playwright), Screenshot, Keyboard
│   ├── voice/                 @vena/voice - ElevenLabs TTS, Whisper STT, Twilio Calls
│   ├── integrations/          @vena/integrations - Gmail, Docs, Sheets, Calendar, Drive
│   └── agents/                @vena/agents - MeshNetwork, MessageBus, Consultation, Delegation
├── install.sh                 Curl-able installer with orange theme
├── setup.sh                   Local dev setup
├── Dockerfile                 Multi-stage build
└── docker-compose.yml         Full stack compose
```

## Key Patterns

### Provider Factory (lib/runtime.ts)
`createProvider(config, overrideProvider?, overrideModel?)` returns `{ provider: LLMProvider, model, providerName }`.
Supports Anthropic, OpenAI, Gemini, Ollama. All providers use lazy `ensureClient()` for OAuth token resolution.

### Message Flow (vena start)
```
Channel (Telegram/WhatsApp/HTTP/WebSocket)
  → handleMessage(InboundMessage)
    → getOrCreateSession(sessionKey)
      → AgentLoop.run(userMessage, session)  [AsyncIterable<AgentEvent>]
        → LLM Provider.chat(params)  [AsyncIterable<StreamChunk>]
          → Tool execution loop (if tool_use stop reason)
      → Collect response text
    → Channel.send(sessionKey, { text })
    → MemoryManager.log()
```

### Config (Zod)
Config lives at `~/.vena/vena.json`. Schema in `packages/shared/src/config.ts`.
Supports env var resolution (`${VAR_NAME}` syntax).

### Streaming Protocol
All providers emit `AsyncIterable<StreamChunk>` with types: `text`, `tool_use`, `tool_use_input`, `stop`, `error`.

## What's Wired vs What's Not

### FULLY WIRED (working end-to-end):
- `vena onboard` → 6-step wizard → writes `~/.vena/vena.json`
- `vena chat` → real LLM streaming via provider, token counting, readline REPL
- `vena start` → Fastify gateway + Telegram + WhatsApp + AgentLoop + MemoryManager
- HTTP API: `/api/message`, `/health`, `/api/status`, `/api/sessions`, `/api/agents`
- OpenAI-compatible: `/v1/chat/completions` (streaming + non-streaming)
- WebSocket: real-time chat
- OAuth auth: all providers support API key, OAuth token, Bearer token with auto-refresh

### PACKAGES BUILT BUT NOT YET WIRED INTO START:
- `@vena/semantic-memory` - MemoryEngine exists but MemoryManager uses flat file only
- `@vena/skills` - SkillRegistry exists but AgentLoop has empty tools array
- `@vena/computer` - Shell/Browser tools exist but not registered in AgentLoop
- `@vena/voice` - TTS/STT exist but channels don't process voice messages through them
- `@vena/agents` - MeshNetwork exists but start.ts only creates single agent
- `@vena/integrations` - Google APIs exist but not connected as tools

### NEXT PRIORITY:
Wire semantic memory into core → Wire skills/computer tools into AgentLoop → Wire voice into channels → Wire multi-agent mesh → README

## Build Commands

```bash
pnpm install                    # Install all dependencies
pnpm -r build                   # Build all 12 packages
pnpm --filter @vena/cli build   # Build just CLI
pnpm --filter @vena/shared build && pnpm -r build  # Rebuild from shared up
```

## Testing

```bash
# Quick smoke test
node apps/cli/dist/index.js --help
node apps/cli/dist/index.js start --help
node apps/cli/dist/index.js chat --help

# E2E test (requires API key configured):
# 1. Run: vena start
# 2. curl -X POST http://localhost:18789/api/message -H 'Content-Type: application/json' -d '{"content":"Hello"}'
```
