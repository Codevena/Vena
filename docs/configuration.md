# Configuration

Complete reference for the Vena configuration file at `~/.vena/vena.json`.

## Table of Contents
- [Overview](#overview)
- [Providers](#providers)
- [Channels](#channels)
- [Gateway](#gateway)
- [Agents](#agents)
- [Memory](#memory)
- [Security](#security)
- [Computer](#computer)
- [Voice](#voice)
- [Google Workspace](#google-workspace)
- [Skills](#skills)
- [User Profile](#user-profile)
- [Environment Variables](#environment-variables)

## Overview

The config file uses JSON with Zod schema validation. All fields have sensible defaults.

**Location:** `~/.vena/vena.json`

**View config:**
```bash
vena config
```

**Edit config:**
```bash
vena config edit
```

## Providers

Configure LLM providers and authentication.

### Schema

```json
{
  "providers": {
    "default": "anthropic",
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY}",
      "model": "claude-sonnet-4-20250514"
    },
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "model": "gpt-4o",
      "baseUrl": "https://api.openai.com/v1"
    },
    "gemini": {
      "apiKey": "${GEMINI_API_KEY}",
      "model": "gemini-2.0-flash-exp",
      "transport": "api",
      "vertexai": false
    },
    "ollama": {
      "baseUrl": "http://localhost:11434",
      "model": "llama3"
    },
    "groq": {
      "apiKey": "${GROQ_API_KEY}",
      "model": "llama-3.3-70b-versatile"
    },
    "openrouter": {
      "apiKey": "${OPENROUTER_API_KEY}",
      "model": "anthropic/claude-3.5-sonnet",
      "baseUrl": "https://openrouter.ai/api/v1"
    }
  }
}
```

### Fields

**`providers.default`** (string, default: `"anthropic"`)
- Default provider when not specified
- Options: `anthropic`, `openai`, `gemini`, `ollama`, `groq`, `openrouter`

**`providers.anthropic`** (object, optional)
- `apiKey` (string) - Anthropic API key
- `model` (string) - Model name (e.g., `claude-sonnet-4-20250514`)
- `auth` (object, optional) - OAuth configuration
  - `type` - `api_key`, `oauth_token`, or `bearer_token`
  - `oauthToken` - OAuth access token
  - `refreshToken` - Refresh token for auto-renewal
  - `tokenUrl` - Token refresh endpoint
  - `clientId` - OAuth client ID
  - `clientSecret` - OAuth client secret
  - `expiresAt` - Unix timestamp for token expiry

**`providers.openai`** (object, optional)
- Same fields as `anthropic`
- `baseUrl` (string) - API base URL (for Azure/custom endpoints)

**`providers.gemini`** (object, optional)
- Same fields as `anthropic`
- `transport` - `api` or `cli` (defaults to `api`)
- `vertexai` (boolean) - Use Vertex AI instead of Gemini API
- `project` (string) - GCP project ID (for Vertex AI)
- `location` (string) - GCP region (for Vertex AI)
- `apiVersion` (string) - API version

**`providers.ollama`** (object, optional)
- `baseUrl` (string) - Ollama server URL
- `model` (string) - Model name

### Recommended Models

**Anthropic:**
- `claude-opus-4-20250514` - Most capable
- `claude-sonnet-4-20250514` - Best balance
- `claude-3-5-sonnet-20241022` - Fast, cost-effective

**OpenAI:**
- `gpt-4o` - Best overall
- `gpt-4-turbo` - Large context
- `gpt-3.5-turbo` - Fast, cheap

**Gemini:**
- `gemini-2.0-flash-exp` - Experimental, fast
- `gemini-1.5-pro` - Large context (2M tokens)
- `gemini-1.5-flash` - Fast, cost-effective

**Ollama:**
- `llama3` - Good local option
- `mistral` - Fast, capable
- `codellama` - Code-focused

## Channels

Configure messaging channels.

### Schema

```json
{
  "channels": {
    "telegram": {
      "enabled": false,
      "token": "${TELEGRAM_BOT_TOKEN}"
    },
    "whatsapp": {
      "enabled": false
    }
  }
}
```

### Fields

**`channels.telegram`** (object, optional)
- `enabled` (boolean) - Enable Telegram channel
- `token` (string) - Bot token from @BotFather

**`channels.whatsapp`** (object, optional)
- `enabled` (boolean) - Enable WhatsApp channel
- QR code authentication happens on first run

## Gateway

Configure the HTTP/WebSocket server.

### Schema

```json
{
  "gateway": {
    "port": 18789,
    "host": "127.0.0.1",
    "auth": {
      "enabled": false,
      "apiKeys": []
    },
    "rateLimit": {
      "enabled": true,
      "windowMs": 60000,
      "maxRequests": 120
    },
    "maxMessageSize": 102400
  }
}
```

### Fields

**`gateway.port`** (number, default: `18789`)
- HTTP server port

**`gateway.host`** (string, default: `"127.0.0.1"`)
- Bind address (use `0.0.0.0` for external access)

**`gateway.auth.enabled`** (boolean, default: `false`)
- Enable API key authentication

**`gateway.auth.apiKeys`** (string[], default: `[]`)
- List of valid API keys
- Clients must send via `Authorization: Bearer <key>` or `X-API-Key: <key>`

**`gateway.rateLimit.enabled`** (boolean, default: `true`)
- Enable rate limiting

**`gateway.rateLimit.windowMs`** (number, default: `60000`)
- Rate limit window in milliseconds (1 minute)

**`gateway.rateLimit.maxRequests`** (number, default: `120`)
- Max requests per window

**`gateway.maxMessageSize`** (number, default: `102400`)
- Max message size in bytes (100 KB)

## Agents

Configure the agent registry and mesh network.

### Schema

```json
{
  "agents": {
    "defaults": {
      "maxConcurrent": 4
    },
    "registry": [
      {
        "id": "main",
        "name": "Vena",
        "persona": "Helpful personal assistant",
        "provider": "anthropic",
        "model": "claude-sonnet-4-20250514",
        "capabilities": ["general", "coding", "research"],
        "trustLevel": "full",
        "channels": [],
        "character": "nova",
        "authProfile": "default"
      }
    ],
    "mesh": {
      "enabled": true,
      "consultationTimeout": 30000,
      "maxConcurrentConsultations": 3
    }
  }
}
```

### Fields

**`agents.defaults.maxConcurrent`** (number, default: `4`)
- Max concurrent agent operations

**`agents.registry`** (array)
- List of agent configurations

**Agent Config:**
- `id` (string, required) - Unique agent identifier
- `name` (string, required) - Display name
- `persona` (string) - Agent's persona description
- `provider` (string) - LLM provider name
- `model` (string, optional) - Override default model
- `capabilities` (string[]) - Agent capabilities for routing
  - Examples: `general`, `coding`, `research`, `analysis`, `creative`
- `trustLevel` (enum) - Security level
  - `full` - All tools enabled
  - `limited` - No bash/shell
  - `readonly` - Read and web_browse only
- `channels` (string[]) - Allowed channels (empty = all)
- `character` (string) - Character ID
  - Options: `nova`, `sage`, `spark`, `ghost`, `atlas`
- `authProfile` (string, optional) - Auth profile for provider
- `voiceId` (string, optional) - Custom TTS voice ID

**`agents.mesh.enabled`** (boolean, default: `true`)
- Enable mesh network routing

**`agents.mesh.consultationTimeout`** (number, default: `30000`)
- Timeout for agent-to-agent consultations (ms)

**`agents.mesh.maxConcurrentConsultations`** (number, default: `3`)
- Max simultaneous consultations

### Example: Multi-Agent Setup

```json
{
  "agents": {
    "registry": [
      {
        "id": "main",
        "name": "Vena",
        "character": "nova",
        "capabilities": ["general", "coding"],
        "trustLevel": "full"
      },
      {
        "id": "researcher",
        "name": "Research Agent",
        "character": "sage",
        "capabilities": ["research", "analysis"],
        "trustLevel": "limited"
      },
      {
        "id": "creative",
        "name": "Creative Agent",
        "character": "spark",
        "capabilities": ["creative", "brainstorming"],
        "trustLevel": "readonly"
      }
    ],
    "mesh": {
      "enabled": true
    }
  }
}
```

## Memory

Configure memory storage and semantic features.

### Schema

```json
{
  "memory": {
    "vectorSearch": true,
    "embeddingProvider": "anthropic",
    "semanticMemory": {
      "enabled": true,
      "entityExtraction": true,
      "knowledgeGraph": true,
      "autoConsolidate": true,
      "consolidateInterval": "24h"
    },
    "sharedMemory": {
      "enabled": true,
      "crossAgentSearch": true
    }
  }
}
```

### Fields

**`memory.vectorSearch`** (boolean, default: `true`)
- Enable embedding-based search

**`memory.embeddingProvider`** (string, default: `"anthropic"`)
- Provider for generating embeddings

**`memory.semanticMemory.enabled`** (boolean, default: `true`)
- Enable knowledge graph memory

**`memory.semanticMemory.entityExtraction`** (boolean, default: `true`)
- Extract entities from conversations

**`memory.semanticMemory.knowledgeGraph`** (boolean, default: `true`)
- Build relationship graph

**`memory.semanticMemory.autoConsolidate`** (boolean, default: `true`)
- Automatically consolidate memories

**`memory.semanticMemory.consolidateInterval`** (string, default: `"24h"`)
- Consolidation frequency

**`memory.sharedMemory.enabled`** (boolean, default: `true`)
- Share memory between agents

**`memory.sharedMemory.crossAgentSearch`** (boolean, default: `true`)
- Allow agents to search each other's memories

## Security

Configure security policies and trust levels.

### Schema

```json
{
  "security": {
    "defaultTrustLevel": "limited",
    "pathPolicy": {
      "blockedPatterns": [".env", ".ssh", ".aws", ".git/config"]
    },
    "shell": {
      "allowedCommands": ["git", "npm", "pnpm", "node", "npx", "ls", "cat", "find", "grep"],
      "envPassthrough": ["PATH", "HOME", "USER", "SHELL", "LANG", "NODE_ENV"]
    },
    "urlPolicy": {
      "allowPrivateIPs": false
    }
  }
}
```

### Fields

**`security.defaultTrustLevel`** (enum, default: `"limited"`)
- Default trust level for agents
- Options: `full`, `limited`, `readonly`

**`security.pathPolicy.blockedPatterns`** (string[])
- File patterns to block from read/write

**`security.shell.allowedCommands`** (string[])
- Allowlist of shell commands (trust level `full` only)

**`security.shell.envPassthrough`** (string[])
- Environment variables to pass to subprocesses

**`security.urlPolicy.allowPrivateIPs`** (boolean, default: `false`)
- Allow fetching from private IP ranges

## Computer

Configure computer control tools.

### Schema

```json
{
  "computer": {
    "shell": {
      "enabled": true,
      "allowedCommands": ["git", "npm", "pnpm", "node", "npx", "ls", "find", "grep"]
    },
    "browser": {
      "enabled": true,
      "headless": false
    },
    "keyboard": {
      "enabled": false
    },
    "screenshot": {
      "enabled": true
    },
    "docker": {
      "enabled": false,
      "image": "node:22-slim",
      "memoryLimit": "512m",
      "cpuLimit": "1.0",
      "network": "none",
      "readOnlyRoot": true
    }
  }
}
```

### Fields

**`computer.shell.enabled`** (boolean, default: `true`)
- Enable bash tool

**`computer.browser.enabled`** (boolean, default: `true`)
- Enable browser automation

**`computer.browser.headless`** (boolean, default: `false`)
- Run browser in headless mode

**`computer.screenshot.enabled`** (boolean, default: `true`)
- Enable screenshot tool

**`computer.docker.enabled`** (boolean, default: `false`)
- Run tools in Docker sandbox

**`computer.docker`** settings:
- `image` - Docker image
- `memoryLimit` - Memory limit
- `cpuLimit` - CPU limit
- `network` - Network mode (`none`, `host`, `bridge`)
- `readOnlyRoot` - Mount root filesystem as read-only

## Voice

Configure voice input/output.

### Schema

```json
{
  "voice": {
    "tts": {
      "provider": "elevenlabs",
      "apiKey": "${ELEVENLABS_API_KEY}",
      "defaultVoice": "adam",
      "model": "eleven_multilingual_v2"
    },
    "stt": {
      "provider": "whisper",
      "model": "whisper-1",
      "apiKey": "${OPENAI_API_KEY}"
    },
    "calls": {
      "enabled": false,
      "provider": "twilio",
      "accountSid": "${TWILIO_ACCOUNT_SID}",
      "authToken": "${TWILIO_AUTH_TOKEN}",
      "phoneNumber": "${TWILIO_PHONE_NUMBER}"
    },
    "autoVoiceReply": true
  }
}
```

### Fields

**`voice.tts.provider`** (enum, default: `"elevenlabs"`)
- TTS provider: `elevenlabs` or `openai-tts`

**`voice.tts.apiKey`** (string)
- TTS provider API key

**`voice.tts.defaultVoice`** (string, default: `"adam"`)
- Default voice ID

**`voice.tts.model`** (string)
- TTS model name

**`voice.stt.provider`** (enum, default: `"whisper"`)
- STT provider: `whisper` or `deepgram`

**`voice.stt.model`** (string, default: `"whisper-1"`)
- STT model name

**`voice.calls.enabled`** (boolean, default: `false`)
- Enable phone calls

**`voice.calls.provider`** (enum, default: `"twilio"`)
- Call provider: `twilio` or `vapi`

**`voice.autoVoiceReply`** (boolean, default: `true`)
- Auto-reply with voice to voice messages

## Google Workspace

Configure Google Workspace integration.

### Schema

```json
{
  "google": {
    "clientId": "${GOOGLE_CLIENT_ID}",
    "clientSecret": "${GOOGLE_CLIENT_SECRET}",
    "scopes": ["gmail", "docs", "sheets", "calendar", "drive"]
  }
}
```

### Fields

**`google.clientId`** (string)
- OAuth client ID from Google Cloud Console

**`google.clientSecret`** (string)
- OAuth client secret

**`google.scopes`** (string[])
- Requested OAuth scopes

### Setup

Coming soon:
```bash
vena config google-auth
```

## Skills

Configure skill directories.

### Schema

```json
{
  "skills": {
    "dirs": ["./skills"],
    "managed": "~/.vena/skills"
  }
}
```

### Fields

**`skills.dirs`** (string[])
- Workspace skill directories to scan

**`skills.managed`** (string, default: `"~/.vena/skills"`)
- Directory for installed managed skills

## User Profile

Configure user information for character personalization.

### Schema

```json
{
  "userProfile": {
    "name": "Your Name",
    "preferredName": "Nickname",
    "language": "en",
    "timezone": "America/Los_Angeles",
    "notes": "Likes concise responses. Uses TypeScript."
  }
}
```

### Fields

**`userProfile.name`** (string, required)
- Your full name

**`userProfile.preferredName`** (string, optional)
- How you prefer to be addressed

**`userProfile.language`** (string, default: `"en"`)
- Language code

**`userProfile.timezone`** (string, optional)
- IANA timezone

**`userProfile.notes`** (string, optional)
- Free-form notes for character personalization

## Environment Variables

Config values support environment variable substitution:

```json
{
  "providers": {
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  }
}
```

At runtime, `${VAR_NAME}` is replaced with `process.env.VAR_NAME`.

## Full Example

```json
{
  "providers": {
    "default": "anthropic",
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY}",
      "model": "claude-sonnet-4-20250514"
    }
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "${TELEGRAM_BOT_TOKEN}"
    }
  },
  "gateway": {
    "port": 18789,
    "auth": {
      "enabled": false
    },
    "rateLimit": {
      "enabled": true,
      "maxRequests": 120
    }
  },
  "agents": {
    "registry": [
      {
        "id": "main",
        "name": "Vena",
        "character": "nova",
        "capabilities": ["general", "coding"],
        "trustLevel": "full"
      }
    ],
    "mesh": {
      "enabled": true
    }
  },
  "memory": {
    "semanticMemory": {
      "enabled": true,
      "entityExtraction": true,
      "knowledgeGraph": true
    }
  },
  "security": {
    "defaultTrustLevel": "limited"
  },
  "voice": {
    "tts": {
      "provider": "elevenlabs",
      "apiKey": "${ELEVENLABS_API_KEY}"
    },
    "stt": {
      "provider": "whisper",
      "apiKey": "${OPENAI_API_KEY}"
    }
  },
  "skills": {
    "dirs": ["./skills"]
  },
  "userProfile": {
    "name": "Your Name",
    "language": "en"
  }
}
```
