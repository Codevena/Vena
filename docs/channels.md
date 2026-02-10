# Channels

Setup guide for messaging channels in Vena.

## Table of Contents
- [Overview](#overview)
- [Telegram](#telegram)
- [WhatsApp](#whatsapp)
- [Slack](#slack)
- [Discord](#discord)
- [HTTP](#http)
- [WebSocket](#websocket)

## Overview

Vena supports multiple messaging channels for interacting with agents:

| Channel | Status | Library | Auth Method |
|---------|--------|---------|-------------|
| Telegram | Fully wired | grammY | Bot token |
| WhatsApp | Fully wired | Baileys | QR code |
| Slack | Coming soon | @slack/bolt | OAuth |
| Discord | Coming soon | discord.js | Bot token |
| HTTP | Fully wired | Built-in | API key (optional) |
| WebSocket | Fully wired | Built-in | API key (optional) |

## Telegram

Telegram bot integration via grammY.

### Setup

**1. Create a bot with BotFather**

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot`
3. Follow prompts to choose a name and username
4. Copy the bot token (looks like `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`)

**2. Configure Vena**

Edit `~/.vena/vena.json`:
```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "${TELEGRAM_BOT_TOKEN}"
    }
  }
}
```

**3. Set environment variable**

```bash
export TELEGRAM_BOT_TOKEN="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz"
```

Or hardcode in config (not recommended for production).

**4. Start Vena**

```bash
vena start
```

**5. Test the bot**

1. Find your bot in Telegram (search by username)
2. Send `/start` to begin
3. Send a message

### Features

**Text Messages:**
```
User: Hello!
Bot: Hey. What are we working on?
```

**Voice Messages:**
If voice is configured, send voice messages:
- Bot transcribes via Whisper/Deepgram
- Responds with text or voice (based on `autoVoiceReply`)

**Media:**
- Photos with captions
- Documents
- Audio files

**Markdown Formatting:**
Bot sends responses with Markdown formatting:
- **bold**, *italic*, `code`
- Code blocks with syntax highlighting
- Bullet lists

### Commands

Default commands (customizable):
- `/start` - Start conversation
- `/help` - Show help
- `/clear` - Clear session history
- `/status` - Show agent status

### Configuration

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "${TELEGRAM_BOT_TOKEN}"
    }
  }
}
```

### Troubleshooting

**Bot doesn't respond:**
- Check token is correct
- Verify bot is not blocked by BotFather
- Check logs: `vena start 2>&1 | grep -i telegram`

**Token invalid:**
- Generate new token with `/token` in BotFather
- Update config and restart

## WhatsApp

WhatsApp bot integration via Baileys.

### Setup

**1. Configure Vena**

Edit `~/.vena/vena.json`:
```json
{
  "channels": {
    "whatsapp": {
      "enabled": true
    }
  }
}
```

**2. Start Vena**

```bash
vena start
```

**3. Scan QR Code**

On first run, Vena displays a QR code in the terminal:

```
WhatsApp QR Code:
[QR code appears here]

Scan this with WhatsApp (Settings -> Linked Devices -> Link a Device)
```

**4. Scan with WhatsApp**

1. Open WhatsApp on your phone
2. Go to Settings > Linked Devices
3. Tap "Link a Device"
4. Scan the QR code displayed in terminal

**5. Test the bot**

Send a message to your WhatsApp number (the one you scanned with).

### Features

**Text Messages:**
```
You: Hello!
Bot: Hey. What are we working on?
```

**Voice Messages:**
If voice is configured:
- Send voice message
- Bot transcribes and responds (text or voice)

**Media:**
- Images with captions
- Documents
- Audio files
- Videos

### Session Persistence

WhatsApp session is saved to:
```
~/.vena/sessions/whatsapp-auth.json
```

You only need to scan QR code once. Session persists across restarts.

### Configuration

```json
{
  "channels": {
    "whatsapp": {
      "enabled": true
    }
  }
}
```

### Troubleshooting

**QR code not appearing:**
- Check logs: `vena start 2>&1 | grep -i whatsapp`
- Verify port 18789 is not blocked

**QR code expired:**
- Restart Vena to generate new QR code
- Scan within 60 seconds

**Connection lost:**
- WhatsApp may disconnect after inactivity
- Restart Vena to reconnect
- May need to scan QR again if session expired

**Multiple devices:**
- WhatsApp supports up to 4 linked devices
- Unlink old devices before scanning new QR

## Slack

Slack bot integration via @slack/bolt.

### Status

Coming soon. Framework in place but not yet wired to `start.ts`.

### Planned Setup

**1. Create Slack App**

1. Go to https://api.slack.com/apps
2. Click "Create New App"
3. Choose "From scratch"
4. Name your app and select workspace

**2. Configure Bot**

1. Go to "OAuth & Permissions"
2. Add bot token scopes:
   - `chat:write` - Send messages
   - `channels:history` - Read channel messages
   - `im:history` - Read DMs
   - `files:write` - Upload files
3. Install app to workspace
4. Copy Bot User OAuth Token

**3. Configure Vena**

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "botToken": "${SLACK_BOT_TOKEN}",
      "signingSecret": "${SLACK_SIGNING_SECRET}"
    }
  }
}
```

**4. Set environment variables**

```bash
export SLACK_BOT_TOKEN="xoxb-..."
export SLACK_SIGNING_SECRET="..."
```

**5. Start Vena**

```bash
vena start
```

### Features (Planned)

- Direct messages
- Channel mentions (@vena)
- Slash commands (`/vena help`)
- Interactive buttons
- File uploads
- Threaded conversations

## Discord

Discord bot integration via discord.js.

### Status

Coming soon. Framework in place but not yet wired to `start.ts`.

### Planned Setup

**1. Create Discord Application**

1. Go to https://discord.com/developers/applications
2. Click "New Application"
3. Name your application

**2. Create Bot**

1. Go to "Bot" section
2. Click "Add Bot"
3. Copy bot token
4. Enable "Message Content Intent" under Privileged Gateway Intents

**3. Invite Bot**

1. Go to "OAuth2" > "URL Generator"
2. Select scopes:
   - `bot`
   - `applications.commands`
3. Select permissions:
   - `Send Messages`
   - `Read Message History`
   - `Use Slash Commands`
4. Copy generated URL and open in browser
5. Select server and authorize

**4. Configure Vena**

```json
{
  "channels": {
    "discord": {
      "enabled": true,
      "token": "${DISCORD_BOT_TOKEN}"
    }
  }
}
```

**5. Set environment variable**

```bash
export DISCORD_BOT_TOKEN="..."
```

**6. Start Vena**

```bash
vena start
```

### Features (Planned)

- Direct messages
- Channel mentions (@Vena)
- Slash commands (`/vena help`)
- Voice channel integration (with voice pipeline)
- Embeds for rich responses
- Reaction-based interactions

## HTTP

REST API for programmatic access.

### Overview

Fully wired and production-ready.

### Endpoints

**POST /api/message**
Send a message and get a response.

**Request:**
```bash
curl -X POST http://localhost:18789/api/message \
  -H 'Content-Type: application/json' \
  -d '{
    "content": "Hello!",
    "sessionKey": "user-123",
    "userId": "user-123"
  }'
```

**Response:**
```json
{
  "sessionKey": "user-123",
  "response": "Hey. What are we working on?"
}
```

**GET /health**
Health check.

```bash
curl http://localhost:18789/health
```

Response:
```json
{
  "status": "ok",
  "uptime": 12345
}
```

**GET /api/status**
Platform status.

```bash
curl http://localhost:18789/api/status
```

Response:
```json
{
  "status": "running",
  "agents": 1,
  "sessions": 5,
  "channels": ["telegram", "http"]
}
```

**GET /api/sessions**
List active sessions.

```bash
curl http://localhost:18789/api/sessions
```

Response:
```json
{
  "sessions": [
    {
      "id": "session-abc",
      "sessionKey": "user-123",
      "agentId": "main",
      "messageCount": 10,
      "lastActivity": "2025-02-10T14:30:00Z"
    }
  ]
}
```

**GET /api/agents**
List registered agents.

```bash
curl http://localhost:18789/api/agents
```

Response:
```json
{
  "agents": [
    {
      "id": "main",
      "name": "Vena",
      "character": "nova",
      "status": "active",
      "capabilities": ["general", "coding"]
    }
  ]
}
```

### Authentication

Optional API key authentication:

**1. Configure:**
```json
{
  "gateway": {
    "auth": {
      "enabled": true,
      "apiKeys": ["secret-key-1", "secret-key-2"]
    }
  }
}
```

**2. Use API key:**

Via `Authorization` header:
```bash
curl -X POST http://localhost:18789/api/message \
  -H 'Authorization: Bearer secret-key-1' \
  -H 'Content-Type: application/json' \
  -d '{"content":"Hello"}'
```

Via `X-API-Key` header:
```bash
curl -X POST http://localhost:18789/api/message \
  -H 'X-API-Key: secret-key-1' \
  -H 'Content-Type: application/json' \
  -d '{"content":"Hello"}'
```

### Rate Limiting

Enabled by default:

```json
{
  "gateway": {
    "rateLimit": {
      "enabled": true,
      "windowMs": 60000,
      "maxRequests": 120
    }
  }
}
```

- 120 requests per minute per IP
- Returns 429 Too Many Requests when exceeded

### Configuration

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
      "maxRequests": 120
    }
  }
}
```

## WebSocket

Real-time streaming chat via WebSocket.

### Overview

Fully wired and production-ready.

### Connection

**Connect:**
```javascript
const ws = new WebSocket('ws://localhost:18789');

ws.on('open', () => {
  console.log('Connected');
});
```

**Send message:**
```javascript
ws.send(JSON.stringify({
  content: 'Hello!',
  sessionKey: 'user-123',
  userId: 'user-123'
}));
```

**Receive response:**
```javascript
ws.on('message', (data) => {
  const message = JSON.parse(data);
  console.log(message.response);
});
```

### Using wscat

Install:
```bash
npm install -g wscat
```

Connect:
```bash
wscat -c ws://localhost:18789
```

Send message:
```json
{"content":"Hello!","sessionKey":"user-123"}
```

### Streaming

Responses stream in real-time:

```javascript
ws.on('message', (data) => {
  const chunk = JSON.parse(data);

  if (chunk.type === 'text') {
    process.stdout.write(chunk.text);
  } else if (chunk.type === 'stop') {
    console.log('\n[Done]');
  }
});
```

### Authentication

Same as HTTP - send API key in connection query:

```javascript
const ws = new WebSocket('ws://localhost:18789?apiKey=secret-key-1');
```

Or in initial message:
```json
{
  "apiKey": "secret-key-1",
  "content": "Hello!"
}
```

### Rate Limiting

WebSocket connections are rate-limited per IP:
- Max 120 messages per minute
- Connection closed on violation

### Configuration

Same as HTTP gateway:
```json
{
  "gateway": {
    "port": 18789,
    "host": "127.0.0.1",
    "auth": {
      "enabled": true,
      "apiKeys": ["secret-key-1"]
    },
    "rateLimit": {
      "enabled": true,
      "maxRequests": 120
    }
  }
}
```

## Multi-Channel Setup

Run multiple channels simultaneously:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "${TELEGRAM_BOT_TOKEN}"
    },
    "whatsapp": {
      "enabled": true
    }
  },
  "gateway": {
    "port": 18789
  }
}
```

Start:
```bash
vena start
```

Now accessible via:
- Telegram bot
- WhatsApp
- HTTP (localhost:18789/api/message)
- WebSocket (ws://localhost:18789)

## Channel-Specific Agents

Route different channels to different agents:

```json
{
  "agents": {
    "registry": [
      {
        "id": "telegram-agent",
        "character": "ghost",
        "channels": ["telegram"]
      },
      {
        "id": "api-agent",
        "character": "nova",
        "channels": ["http", "websocket"]
      },
      {
        "id": "whatsapp-agent",
        "character": "sage",
        "channels": ["whatsapp"]
      }
    ]
  }
}
```

## Voice Integration

Enable voice for Telegram and WhatsApp:

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

Now:
- Send voice message on Telegram/WhatsApp
- Bot transcribes with STT
- Bot responds with voice (if `autoVoiceReply` is true)

## Best Practices

### Security

1. Use API key authentication for HTTP/WebSocket
2. Keep bot tokens secret (use environment variables)
3. Enable rate limiting
4. Bind to `127.0.0.1` for local-only access
5. Use reverse proxy (nginx) for production

### Production Deployment

1. Use process manager (PM2, systemd)
2. Set up reverse proxy with SSL
3. Enable authentication
4. Monitor rate limits
5. Rotate API keys periodically

### Example nginx config:

```nginx
server {
  listen 443 ssl;
  server_name bot.example.com;

  ssl_certificate /path/to/cert.pem;
  ssl_certificate_key /path/to/key.pem;

  location / {
    proxy_pass http://127.0.0.1:18789;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

## Next Steps

- [API Reference](./api.md) - Full HTTP/WebSocket API docs
- [Voice Guide](./voice.md) - Setup voice for channels
- [Configuration](./configuration.md) - Full channel config reference
