# Vena - AI Agent Platform

## Project Context

Vena is an open-source AI agent platform built as a TypeScript monorepo (pnpm workspaces). It's a competitor/alternative to OpenClaw, with key advantages in memory (knowledge graph vs flat Markdown), multi-agent (real mesh vs routing), and auth (OAuth + API key vs API key only).

**Owner:** Markus (@Codevena)
**Repo:** https://github.com/Codevena/Vena.git
**Branch:** `master`
**Size:** 105 TypeScript source files, ~14,500 lines, 12 packages, 8 test files (67 tests)

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
│   ├── shared/                @vena/shared - Types, Config (Zod), Logger (Pino), Errors, Characters
│   ├── providers/             @vena/providers - Anthropic, OpenAI, Gemini, Ollama + auth.ts (OAuth)
│   ├── core/                  @vena/core - AgentLoop, ToolExecutor, ToolGuard, SoulCompiler, MemoryManager, Compaction
│   ├── semantic-memory/       @vena/semantic-memory - KnowledgeGraph, EntityExtractor, SemanticIndex, ContextRanker, MemoryConsolidator, MemoryEngine
│   ├── channels/              @vena/channels - TelegramChannel (grammY), WhatsAppChannel (Baileys)
│   ├── gateway/               @vena/gateway - GatewayServer (Fastify), MessageRouter, LaneQueue, SessionStore, OpenAI-compat API, Auth middleware, Rate limiting
│   ├── skills/                @vena/skills - SkillLoader, SkillParser, SkillRegistry, SkillInjector (XML-escaped)
│   ├── computer/              @vena/computer - Shell, Browser (Playwright), Screenshot, Keyboard
│   ├── voice/                 @vena/voice - ElevenLabs TTS, Whisper STT, Twilio Calls, Character-aware voice
│   ├── integrations/          @vena/integrations - Gmail, Docs, Sheets, Calendar, Drive
│   └── agents/                @vena/agents - MeshNetwork, MessageBus, Consultation, Delegation, Character-aware factory
├── vitest.config.ts           Test configuration
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
  → handleChannelMessage(InboundMessage, sendFn)
    → Voice? VoiceMessagePipeline.processIncoming(audio) → transcribed text
    → selectAgent(content) → MeshNetwork.routeMessage() or defaultAgentId
    → handleMessage(InboundMessage)
      → getOrCreateSession(sessionKey)
        → AgentLoop[targetAgent].run(userMessage, session)  [AsyncIterable<AgentEvent>]
          → LLM Provider.chat(params)  [AsyncIterable<StreamChunk>]
            → Tool execution loop (ToolGuard → ToolExecutor → bash/read/write/edit/web_browse)
        → Collect response text
      → MemoryManager.log() + MemoryEngine.ingest() (knowledge graph)
    → Voice reply? VoiceMessagePipeline.processOutgoing(text) → audio buffer
    → Channel.send(sessionKey, { text, media? })
```

### Memory Architecture
`MemoryManager` accepts optional `SemanticMemoryProvider` (dependency injection).
When semantic memory is enabled: `MemoryEngine` (KnowledgeGraph + EntityExtractor + SemanticIndex + ContextRanker) provides `recall()` for rich context and `ingest()` for entity/relationship extraction after each conversation turn. Falls back to flat file (DailyLog + MEMORY.md) when disabled or on error.

### Security (ToolGuard)
`ToolGuard` sits between `ToolExecutor` and tool execution. Enforces:
- **Trust levels:** `readonly` (read/web_browse only), `limited` (no bash), `full` (all tools)
- **Path validation:** blocks `.env`, `.ssh`, `.aws`, `../ traversal`, enforces allowed workspace roots
- **URL validation:** blocks private IPs (127.x, 10.x, 172.x, 192.168.x), non-http(s) schemes
- **Command validation:** allowlist of safe shell commands
- **Env sanitization:** strips sensitive env vars before subprocess execution

Gateway has API key auth middleware (disabled by default) and in-memory rate limiting (enabled by default).

### Agent Identity (Character System)
5 predefined characters: **Nova** (direct peer), **Sage** (patient teacher), **Spark** (creative collaborator), **Ghost** (minimal signal), **Atlas** (systems thinker).

`SoulCompiler` compiles `Character + UserProfile → system prompt`. ContextBuilder prepends soul prompt before task instructions. `vena chat --character ghost` selects a character. Characters map to TTS voices via `VoiceConfigManager`.

Types: `Character`, `UserProfile`, `AgentSoul`, `CharacterTrait`, `CharacterVoice` in `shared/types.ts`.
Definitions: `CHARACTERS`, `getCharacter()`, `listCharacters()` in `shared/characters.ts`.

### Config (Zod)
Config lives at `~/.vena/vena.json`. Schema in `packages/shared/src/config.ts`.
Supports env var resolution (`${VAR_NAME}` syntax).
Key config sections: `providers`, `channels`, `gateway` (auth, rateLimit), `agents` (registry with character), `memory`, `security` (trustLevel, pathPolicy, shell, urlPolicy), `computer`, `voice`, `skills`, `userProfile`.

### Streaming Protocol
All providers emit `AsyncIterable<StreamChunk>` with types: `text`, `tool_use`, `tool_use_input`, `stop`, `error`.

## What's Wired vs What's Not

### FULLY WIRED (working end-to-end):
- `vena onboard` → 6-step wizard → writes `~/.vena/vena.json`
- `vena chat` → real LLM streaming via provider, token counting, readline REPL, `--character` flag
- `vena start` → Full platform boot:
  - **Tools:** bash, read, write, edit, web_browse, browser (trust-level gated via ToolGuard)
  - **Semantic Memory:** KnowledgeGraph + EntityExtractor + SemanticIndex + ContextRanker via MemoryEngine (when `semanticMemory.enabled`)
  - **Voice:** STT (Whisper/Deepgram) transcription of voice messages + TTS (ElevenLabs/OpenAI) response synthesis via VoiceMessagePipeline (when API keys configured)
  - **Multi-Agent:** Per-agent AgentLoops with own provider/trust/tools + MeshNetwork capability-based routing (when >1 agent in registry)
  - **Skills:** SkillLoader (bundled/managed/workspace) → SkillRegistry → SkillInjector → XML injected into system prompt via ContextBuilder
  - **Channels:** Telegram + WhatsApp with voice-aware handleChannelMessage wrapper
  - **Gateway:** Fastify HTTP + WebSocket + OpenAI-compat API
- HTTP API: `/api/message`, `/health`, `/api/status`, `/api/sessions`, `/api/agents`
- OpenAI-compatible: `/v1/chat/completions` (streaming + non-streaming)
- WebSocket: real-time chat
- OAuth auth: all providers support API key, OAuth token, Bearer token with auto-refresh
- **Security:** ToolGuard enforcement (trust levels, path/URL/command validation, env sanitization)
- **Gateway auth:** API key middleware (Bearer / X-API-Key), rate limiting, message size limits, Zod request validation
- **Skills hardening:** XML escaping in injector, name/length/content validation in parser
- **Agent identity:** 5 characters (Nova/Sage/Spark/Ghost/Atlas), SoulCompiler, UserProfile, character-aware voice
- **Tests:** 8 test files, 67 unit tests (vitest) covering security, identity, gateway, skills

### PACKAGES BUILT BUT NOT YET WIRED INTO START:
- `@vena/integrations` - Google APIs exist but not connected as tools

### NEXT PRIORITY:
Wire Google integrations as tools → README

## Build Commands

```bash
pnpm install                    # Install all dependencies
pnpm -r build                   # Build all 12 packages
pnpm --filter @vena/cli build   # Build just CLI
pnpm --filter @vena/shared build && pnpm -r build  # Rebuild from shared up
```

## Testing

```bash
# Unit tests (67 tests across 8 files)
pnpm test                       # Run all tests via vitest
npx vitest run                  # Run from root directly

# Quick smoke test
node apps/cli/dist/index.js --help
node apps/cli/dist/index.js start --help
node apps/cli/dist/index.js chat --help
node apps/cli/dist/index.js chat --character ghost  # Test character selection

# E2E test (requires API key configured):
# 1. Run: vena start
# 2. curl -X POST http://localhost:18789/api/message -H 'Content-Type: application/json' -d '{"content":"Hello"}'
```

### Test Coverage Map
| Package | Test File | Tests |
|---------|-----------|-------|
| `@vena/core` | `security/__tests__/tool-guard.test.ts` | 11 — trust levels, tool/command validation, env sanitization |
| `@vena/core` | `security/__tests__/path-validator.test.ts` | 9 — traversal, blocked patterns, allowed roots |
| `@vena/core` | `security/__tests__/url-validator.test.ts` | 13 — private IPs, protocol blocking, valid URLs |
| `@vena/core` | `agent/__tests__/soul-compiler.test.ts` | 9 — character compilation, user profile, all 5 characters |
| `@vena/gateway` | `middleware/__tests__/auth.test.ts` | 3 — auth config structure |
| `@vena/gateway` | `middleware/__tests__/rate-limit.test.ts` | 7 — window enforcement, burst, reset, WS limiting |
| `@vena/shared` | `__tests__/characters.test.ts` | 8 — all characters exist, required fields, getCharacter |
| `@vena/skills` | `__tests__/injector.test.ts` | 7 — XML escaping, prompt injection prevention |
