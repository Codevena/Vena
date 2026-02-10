# Getting Started

Quick guide to installing and running Vena for the first time.

## Table of Contents
- [Installation](#installation)
- [First Run](#first-run)
- [Basic Usage](#basic-usage)
- [Next Steps](#next-steps)

## Installation

### Via Curl (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/Codevena/Vena/master/install.sh | bash
```

The installer will:
1. Download the latest release
2. Extract to `~/.vena/bin`
3. Add to your PATH
4. Verify the installation

### Via npm

```bash
npm install -g @vena/cli
```

### From Source

```bash
git clone https://github.com/Codevena/Vena.git
cd Vena
pnpm install
pnpm -r build
npm link apps/cli
```

### Verify Installation

```bash
vena --version
vena --help
```

## First Run

### Onboarding

Run the interactive setup wizard:

```bash
vena onboard
```

This 6-step wizard will guide you through:

**Step 1: Welcome** - Introduction to Vena

**Step 2: Provider Selection** - Choose your LLM provider
- Anthropic
- OpenAI
- Google Gemini
- Ollama (local)

**Step 3: API Key Setup** - Enter your provider API key
- Supports environment variable syntax: `${ANTHROPIC_API_KEY}`
- Keys stored in `~/.vena/vena.json`

**Step 4: Model Selection** - Choose your default model
- Anthropic: `claude-sonnet-4-20250514`, `claude-opus-4-20250514`
- OpenAI: `gpt-4o`, `gpt-4-turbo`
- Gemini: `gemini-2.0-flash-exp`, `gemini-1.5-pro`
- Ollama: `llama3`, `mistral`

**Step 5: Character Selection** - Pick your agent's personality
- **Nova** - Direct peer, cuts through noise
- **Sage** - Patient teacher, explains everything
- **Spark** - Creative collaborator, explores ideas
- **Ghost** - Minimal signal, just the answer
- **Atlas** - Systems thinker, sees the big picture

**Step 6: Optional Features** - Enable advanced features
- Semantic memory (knowledge graph)
- Telegram channel
- WhatsApp channel
- Voice I/O
- Gateway server

After onboarding, your config will be saved to `~/.vena/vena.json`.

## Basic Usage

### Terminal Chat

Start an interactive chat session:

```bash
vena chat
```

**With a specific character:**
```bash
vena chat --character ghost
vena chat --character sage
```

**With a different provider:**
```bash
vena chat --provider openai
vena chat --provider gemini --model gemini-2.0-flash-exp
```

**Features:**
- Streaming responses with token counting
- Syntax highlighting for code blocks
- Multi-line input (type on multiple lines, press Enter twice)
- Exit with `Ctrl+D` or `Ctrl+C`

### Start the Full Platform

Launch all services (gateway, channels, memory, agents):

```bash
vena start
```

This starts:
- HTTP server on port 18789
- WebSocket server
- OpenAI-compatible API endpoint
- Enabled channels (Telegram, WhatsApp)
- Agent loops with configured characters
- Knowledge graph memory (if enabled)
- Voice pipeline (if configured)

**Options:**
```bash
vena start --port 8080              # Custom port
vena start --provider openai        # Override provider
vena start --model gpt-4o           # Override model
```

**Verify it's running:**
```bash
curl http://localhost:18789/health
```

### Send a Message

Via HTTP:
```bash
curl -X POST http://localhost:18789/api/message \
  -H 'Content-Type: application/json' \
  -d '{"content":"Hello! What can you do?"}'
```

Via WebSocket (using wscat):
```bash
npm install -g wscat
wscat -c ws://localhost:18789

# Send message:
{"content":"Hello!"}
```

### View Configuration

```bash
vena config
```

### Edit Configuration

```bash
vena config edit
```

Opens `~/.vena/vena.json` in your default editor.

## Next Steps

### Enable Semantic Memory

1. Edit `~/.vena/vena.json`:
```json
{
  "memory": {
    "semanticMemory": {
      "enabled": true,
      "entityExtraction": true,
      "knowledgeGraph": true
    }
  }
}
```

2. Restart: `vena start`

Your agent will now:
- Extract entities from conversations
- Build a knowledge graph
- Use semantic search for context retrieval
- Consolidate memories over time

### Add Skills

Install a custom skill:
```bash
vena skill install ./path/to/SKILL.md
```

List installed skills:
```bash
vena skill list
```

Validate a skill:
```bash
vena skill validate ./path/to/SKILL.md
```

### Configure Multi-Agent

Edit `~/.vena/vena.json`:
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
      }
    ],
    "mesh": {
      "enabled": true
    }
  }
}
```

View mesh topology:
```bash
vena network
```

### Enable Telegram

1. Create a bot via [@BotFather](https://t.me/botfather)
2. Copy the bot token
3. Edit `~/.vena/vena.json`:
```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "YOUR_BOT_TOKEN"
    }
  }
}
```
4. Restart: `vena start`
5. Message your bot on Telegram

### Enable Voice

1. Get API keys:
   - ElevenLabs: https://elevenlabs.io
   - Whisper: Use OpenAI API key

2. Edit `~/.vena/vena.json`:
```json
{
  "voice": {
    "tts": {
      "provider": "elevenlabs",
      "apiKey": "${ELEVENLABS_API_KEY}"
    },
    "stt": {
      "provider": "whisper",
      "apiKey": "${OPENAI_API_KEY}"
    },
    "autoVoiceReply": true
  }
}
```

3. Restart: `vena start`
4. Send voice messages via Telegram/WhatsApp

### Enable Google Workspace

Coming soon - requires OAuth flow:
```bash
vena config google-auth
```

## Configuration File Location

All configuration is stored in:
```
~/.vena/vena.json
```

Memory and data:
```
~/.vena/sessions/     # Session history
~/.vena/memory/       # Daily logs and MEMORY.md
~/.vena/knowledge/    # Knowledge graph SQLite database
~/.vena/skills/       # Managed skills
```

## Troubleshooting

### Command not found: vena

Add to PATH:
```bash
export PATH="$HOME/.vena/bin:$PATH"
```

Add to your shell profile (`~/.bashrc`, `~/.zshrc`):
```bash
echo 'export PATH="$HOME/.vena/bin:$PATH"' >> ~/.zshrc
```

### API Key Invalid

1. Check your API key is correct
2. Verify environment variable resolution:
```bash
echo $ANTHROPIC_API_KEY
```
3. Try hardcoding the key in `~/.vena/vena.json` temporarily

### Port Already in Use

Change the gateway port:
```bash
vena start --port 8080
```

Or edit config:
```json
{
  "gateway": {
    "port": 8080
  }
}
```

### Provider Connection Failed

1. Check your internet connection
2. Verify API key is valid
3. Check provider status page
4. Try with `--provider ollama` for local testing

## What's Next?

- [Configuration Guide](./configuration.md) - Full config reference
- [Agents Guide](./agents.md) - Multi-agent setup
- [Memory Guide](./memory.md) - Knowledge graph setup
- [Skills Guide](./skills.md) - Create custom skills
- [API Reference](./api.md) - HTTP and WebSocket APIs
