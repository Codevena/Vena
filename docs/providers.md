# Providers

Setup guide for LLM providers supported by Vena.

## Table of Contents
- [Overview](#overview)
- [Anthropic](#anthropic)
- [OpenAI](#openai)
- [Google Gemini](#google-gemini)
- [Ollama](#ollama)
- [Groq](#groq)
- [OpenRouter](#openrouter)
- [OAuth Authentication](#oauth-authentication)

## Overview

Vena supports multiple LLM providers with unified authentication:
- **API Key** - Simple key-based auth
- **OAuth Token** - OAuth 2.0 with auto-refresh
- **Bearer Token** - Custom bearer tokens

All providers emit `AsyncIterable<StreamChunk>` for streaming responses.

## Anthropic

### Setup

1. Get API key from https://console.anthropic.com/

2. Configure in `~/.vena/vena.json`:
```json
{
  "providers": {
    "default": "anthropic",
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY}",
      "model": "claude-sonnet-4-20250514"
    }
  }
}
```

3. Set environment variable:
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

### Recommended Models

| Model | Description | Context | Best For |
|-------|-------------|---------|----------|
| `claude-opus-4-20250514` | Most capable | 200K | Complex reasoning, coding |
| `claude-sonnet-4-20250514` | Best balance | 200K | General use, speed + quality |
| `claude-3-5-sonnet-20241022` | Fast, cost-effective | 200K | Production, high volume |

### Features

- Native tool use
- Vision (image inputs)
- Streaming responses
- System prompts
- XML for structured data

### Usage

```bash
vena chat --provider anthropic
vena start --provider anthropic --model claude-opus-4-20250514
```

### OAuth Setup (Advanced)

For setup tokens:
```json
{
  "providers": {
    "anthropic": {
      "auth": {
        "type": "bearer_token",
        "apiKey": "your-setup-token"
      },
      "model": "claude-sonnet-4-20250514"
    }
  }
}
```

## OpenAI

### Setup

1. Get API key from https://platform.openai.com/

2. Configure:
```json
{
  "providers": {
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "model": "gpt-4o"
    }
  }
}
```

3. Set environment variable:
```bash
export OPENAI_API_KEY="sk-..."
```

### Recommended Models

| Model | Description | Context | Best For |
|-------|-------------|---------|----------|
| `gpt-4o` | Best overall | 128K | General use, multimodal |
| `gpt-4-turbo` | Large context | 128K | Long documents |
| `gpt-3.5-turbo` | Fast, cheap | 16K | Simple tasks |

### Features

- Function calling
- Vision (image inputs)
- JSON mode
- Streaming responses
- Fine-tuning support

### Azure OpenAI

```json
{
  "providers": {
    "openai": {
      "apiKey": "${AZURE_OPENAI_KEY}",
      "baseUrl": "https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT",
      "model": "gpt-4o"
    }
  }
}
```

### Codex OAuth (Advanced)

For OAuth-based authentication:
```json
{
  "providers": {
    "openai": {
      "auth": {
        "type": "oauth_token",
        "oauthToken": "your-access-token",
        "refreshToken": "your-refresh-token",
        "tokenUrl": "https://auth.openai.com/token",
        "clientId": "your-client-id",
        "clientSecret": "your-client-secret",
        "expiresAt": 1234567890
      },
      "model": "gpt-4o"
    }
  }
}
```

## Google Gemini

### Setup

1. Get API key from https://aistudio.google.com/app/apikey

2. Configure:
```json
{
  "providers": {
    "gemini": {
      "apiKey": "${GEMINI_API_KEY}",
      "model": "gemini-2.0-flash-exp",
      "transport": "api"
    }
  }
}
```

3. Set environment variable:
```bash
export GEMINI_API_KEY="..."
```

### Recommended Models

| Model | Description | Context | Best For |
|-------|-------------|---------|----------|
| `gemini-2.0-flash-exp` | Experimental, fast | 1M | Latest features |
| `gemini-1.5-pro` | Large context | 2M | Long documents, analysis |
| `gemini-1.5-flash` | Fast, cost-effective | 1M | Production use |

### Features

- Tool use (function calling)
- Vision
- Extremely large context (2M tokens)
- Streaming
- Multimodal

### Transport Modes

**API Mode (Default)**
```json
{
  "providers": {
    "gemini": {
      "apiKey": "${GEMINI_API_KEY}",
      "transport": "api",
      "model": "gemini-2.0-flash-exp"
    }
  }
}
```

**CLI Mode** (uses `gcloud` CLI):
```json
{
  "providers": {
    "gemini": {
      "transport": "cli",
      "model": "gemini-2.0-flash-exp"
    }
  }
}
```

Requires:
```bash
gcloud auth application-default login
```

### Vertex AI

For GCP projects:
```json
{
  "providers": {
    "gemini": {
      "vertexai": true,
      "project": "your-gcp-project",
      "location": "us-central1",
      "model": "gemini-1.5-pro",
      "apiVersion": "v1"
    }
  }
}
```

Requires:
```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
```

### OAuth (Advanced)

```json
{
  "providers": {
    "gemini": {
      "auth": {
        "type": "oauth_token",
        "oauthToken": "your-access-token",
        "refreshToken": "your-refresh-token",
        "tokenUrl": "https://oauth2.googleapis.com/token",
        "clientId": "your-client-id",
        "clientSecret": "your-client-secret"
      },
      "model": "gemini-2.0-flash-exp"
    }
  }
}
```

## Ollama

### Setup

1. Install Ollama: https://ollama.ai/

2. Pull a model:
```bash
ollama pull llama3
```

3. Configure:
```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434",
      "model": "llama3"
    }
  }
}
```

### Recommended Models

| Model | Description | Size | Best For |
|-------|-------------|------|----------|
| `llama3` | Meta's latest | 8B, 70B | General use |
| `mistral` | Fast, capable | 7B | Speed + quality |
| `codellama` | Code-focused | 7B, 13B, 34B | Coding tasks |
| `phi` | Microsoft small model | 2.7B | Resource-constrained |
| `gemma` | Google open model | 2B, 7B | Efficiency |

### Features

- Fully local (no API keys)
- No rate limits
- Privacy (data stays local)
- Custom models via Modelfile
- Fast inference with GPU

### Custom Models

Create a `Modelfile`:
```dockerfile
FROM llama3

PARAMETER temperature 0.7
PARAMETER top_p 0.9

SYSTEM """You are a helpful coding assistant."""
```

Build:
```bash
ollama create my-custom-model -f Modelfile
```

Use:
```json
{
  "providers": {
    "ollama": {
      "model": "my-custom-model"
    }
  }
}
```

### Remote Ollama

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://192.168.1.100:11434",
      "model": "llama3"
    }
  }
}
```

## Groq

### Setup

1. Get API key from https://console.groq.com/

2. Configure:
```json
{
  "providers": {
    "groq": {
      "apiKey": "${GROQ_API_KEY}",
      "model": "llama-3.3-70b-versatile"
    }
  }
}
```

3. Set environment variable:
```bash
export GROQ_API_KEY="gsk_..."
```

### Recommended Models

| Model | Description | Context | Best For |
|-------|-------------|---------|----------|
| `llama-3.3-70b-versatile` | Latest Llama | 8K | General use |
| `mixtral-8x7b-32768` | MoE architecture | 32K | Long context |
| `gemma-7b-it` | Google's Gemma | 8K | Fast inference |

### Features

- Extremely fast inference (LPU)
- OpenAI-compatible API
- Free tier available
- Tool use support

## OpenRouter

### Setup

1. Get API key from https://openrouter.ai/

2. Configure:
```json
{
  "providers": {
    "openrouter": {
      "apiKey": "${OPENROUTER_API_KEY}",
      "baseUrl": "https://openrouter.ai/api/v1",
      "model": "anthropic/claude-3.5-sonnet"
    }
  }
}
```

3. Set environment variable:
```bash
export OPENROUTER_API_KEY="sk-or-..."
```

### Available Models

OpenRouter provides access to many models:
- `anthropic/claude-opus-4`
- `openai/gpt-4o`
- `google/gemini-pro-1.5`
- `meta-llama/llama-3.1-405b`
- `mistralai/mistral-large`

See full list: https://openrouter.ai/models

### Features

- Single API for multiple providers
- Pay-as-you-go pricing
- Model fallback support
- Usage tracking

## OAuth Authentication

### Overview

All providers support OAuth 2.0 with automatic token refresh.

### Configuration

```json
{
  "providers": {
    "anthropic": {
      "auth": {
        "type": "oauth_token",
        "oauthToken": "your-access-token",
        "refreshToken": "your-refresh-token",
        "tokenUrl": "https://auth.provider.com/token",
        "clientId": "your-client-id",
        "clientSecret": "your-client-secret",
        "expiresAt": 1234567890
      },
      "model": "claude-sonnet-4-20250514"
    }
  }
}
```

### Fields

- `type` - Auth type: `oauth_token`
- `oauthToken` - Current access token
- `refreshToken` - Refresh token for renewal
- `tokenUrl` - Token refresh endpoint
- `clientId` - OAuth client ID
- `clientSecret` - OAuth client secret
- `expiresAt` - Token expiry (Unix timestamp)

### Automatic Refresh

Vena automatically refreshes tokens when:
1. `expiresAt` is in the past
2. API returns 401 Unauthorized

New tokens are saved to config.

### Manual Token Refresh

Coming soon:
```bash
vena config refresh-token --provider anthropic
```

## Provider Selection

### Default Provider

Set in config:
```json
{
  "providers": {
    "default": "anthropic"
  }
}
```

### Per-Command Override

```bash
vena chat --provider openai
vena start --provider gemini --model gemini-2.0-flash-exp
```

### Per-Agent Override

```json
{
  "agents": {
    "registry": [
      {
        "id": "main",
        "provider": "anthropic",
        "model": "claude-sonnet-4-20250514"
      },
      {
        "id": "researcher",
        "provider": "gemini",
        "model": "gemini-1.5-pro"
      }
    ]
  }
}
```

## Best Practices

### API Keys

- Use environment variables for secrets
- Never commit keys to git
- Rotate keys periodically
- Use separate keys for dev/prod

### Model Selection

- **Prototyping:** Use fast, cheap models (GPT-3.5, Gemini Flash)
- **Production:** Use balanced models (Claude Sonnet, GPT-4o)
- **Complex tasks:** Use flagship models (Claude Opus, GPT-4 Turbo)
- **Local/private:** Use Ollama

### Cost Optimization

- Start with smaller models
- Use streaming to show progress
- Implement caching where possible
- Monitor usage via provider dashboards

### Fallback Strategy

```json
{
  "agents": {
    "registry": [
      {
        "id": "main",
        "provider": "anthropic",
        "model": "claude-sonnet-4-20250514"
      }
    ]
  },
  "providers": {
    "anthropic": { "apiKey": "${ANTHROPIC_API_KEY}" },
    "openai": { "apiKey": "${OPENAI_API_KEY}" }
  }
}
```

If Anthropic fails, manually switch:
```bash
vena start --provider openai
```

## Troubleshooting

### Invalid API Key

- Verify key in provider console
- Check environment variable: `echo $ANTHROPIC_API_KEY`
- Try hardcoding key temporarily to rule out env issues

### Rate Limits

- Check provider dashboard for limits
- Implement exponential backoff (built-in)
- Upgrade to higher tier
- Use multiple API keys with rotation

### Connection Errors

- Check internet connection
- Verify provider status page
- Check firewall/proxy settings
- For Ollama: Ensure server is running

### Model Not Found

- Verify model name in provider docs
- For Ollama: Run `ollama pull <model>` first
- Check if model requires special access

## Next Steps

- [Agents Guide](./agents.md) - Configure per-agent providers
- [Configuration](./configuration.md) - Full config reference
- [Security](./security.md) - API key security best practices
