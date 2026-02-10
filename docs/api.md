# API Reference

Complete HTTP, WebSocket, and OpenAI-compatible API documentation.

## Table of Contents
- [Overview](#overview)
- [HTTP API](#http-api)
- [WebSocket](#websocket)
- [OpenAI-Compatible API](#openai-compatible-api)
- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Error Handling](#error-handling)

## Overview

Vena provides three API interfaces:

**HTTP REST API** - Standard REST endpoints for messages, status, sessions
**WebSocket** - Real-time streaming chat
**OpenAI-Compatible** - Drop-in replacement for OpenAI API

All APIs run on the same gateway server (default port: 18789).

## HTTP API

### Base URL

```
http://localhost:18789
```

### Endpoints

#### POST /api/message

Send a message and get a response.

**Request:**
```bash
curl -X POST http://localhost:18789/api/message \
  -H 'Content-Type: application/json' \
  -d '{
    "content": "Hello! What can you do?",
    "sessionKey": "user-123",
    "userId": "user-123",
    "userName": "Alice"
  }'
```

**Request Body:**
```typescript
{
  content: string;           // Required: Message text
  sessionKey?: string;       // Optional: Session identifier
  userId?: string;           // Optional: User identifier
  userName?: string;         // Optional: User display name
  agentId?: string;          // Optional: Target agent ID
  media?: Array<{            // Optional: Media attachments
    type: 'photo' | 'audio' | 'video' | 'document';
    url?: string;
    buffer?: string;         // Base64-encoded
    mimeType: string;
  }>;
}
```

**Response:**
```json
{
  "sessionKey": "user-123",
  "response": "Hey. What are we working on?",
  "agentId": "main",
  "timestamp": "2025-02-10T14:30:00Z"
}
```

**Response Body:**
```typescript
{
  sessionKey: string;
  response: string;
  agentId: string;
  timestamp: string;
  metadata?: {
    tokenCount?: number;
    modelUsed?: string;
  };
}
```

**Status Codes:**
- `200 OK` - Success
- `400 Bad Request` - Invalid request body
- `401 Unauthorized` - Auth required
- `413 Payload Too Large` - Message exceeds size limit
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error

#### GET /health

Health check endpoint.

**Request:**
```bash
curl http://localhost:18789/health
```

**Response:**
```json
{
  "status": "ok",
  "uptime": 12345,
  "version": "0.1.0"
}
```

**Status Codes:**
- `200 OK` - Healthy
- `503 Service Unavailable` - Unhealthy

#### GET /api/status

Platform status information.

**Request:**
```bash
curl http://localhost:18789/api/status
```

**Response:**
```json
{
  "status": "running",
  "agents": 2,
  "sessions": 5,
  "channels": ["telegram", "whatsapp", "http", "websocket"],
  "memory": {
    "semanticEnabled": true,
    "entities": 142,
    "relationships": 89
  },
  "uptime": 86400
}
```

**Status Codes:**
- `200 OK` - Success

#### GET /api/sessions

List active sessions.

**Request:**
```bash
curl http://localhost:18789/api/sessions
```

**Response:**
```json
{
  "sessions": [
    {
      "id": "session-abc",
      "sessionKey": "user-123",
      "channelName": "telegram",
      "agentId": "main",
      "messageCount": 10,
      "tokenCount": 5420,
      "createdAt": "2025-02-10T10:00:00Z",
      "lastActivity": "2025-02-10T14:30:00Z"
    }
  ],
  "total": 5
}
```

**Query Parameters:**
- `limit` (number) - Max sessions to return (default: 50)
- `offset` (number) - Pagination offset (default: 0)
- `agentId` (string) - Filter by agent
- `channelName` (string) - Filter by channel

**Example:**
```bash
curl 'http://localhost:18789/api/sessions?agentId=main&limit=10'
```

**Status Codes:**
- `200 OK` - Success

#### GET /api/agents

List registered agents.

**Request:**
```bash
curl http://localhost:18789/api/agents
```

**Response:**
```json
{
  "agents": [
    {
      "id": "main",
      "name": "Vena",
      "character": "nova",
      "status": "active",
      "capabilities": ["general", "coding", "research"],
      "trustLevel": "full",
      "provider": "anthropic",
      "model": "claude-sonnet-4-20250514",
      "channels": []
    }
  ],
  "total": 2
}
```

**Status Codes:**
- `200 OK` - Success

## WebSocket

Real-time streaming chat via WebSocket.

### Connection

**Connect:**
```javascript
const ws = new WebSocket('ws://localhost:18789');

ws.on('open', () => {
  console.log('Connected to Vena');
});

ws.on('close', () => {
  console.log('Disconnected');
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});
```

### Send Message

**Format:**
```javascript
ws.send(JSON.stringify({
  content: 'Hello!',
  sessionKey: 'user-123',
  userId: 'user-123',
  userName: 'Alice'
}));
```

**Fields:**
```typescript
{
  content: string;           // Required
  sessionKey?: string;       // Optional
  userId?: string;           // Optional
  userName?: string;         // Optional
  agentId?: string;          // Optional
}
```

### Receive Response

**Streaming chunks:**
```javascript
ws.on('message', (data) => {
  const chunk = JSON.parse(data);

  switch (chunk.type) {
    case 'text':
      process.stdout.write(chunk.text);
      break;

    case 'tool_use':
      console.log(`\n[Tool: ${chunk.toolUse.name}]`);
      break;

    case 'stop':
      console.log('\n[Done]');
      break;

    case 'error':
      console.error('\n[Error]', chunk.error);
      break;
  }
});
```

**Chunk Types:**
```typescript
// Text chunk
{
  type: 'text';
  text: string;
}

// Tool use started
{
  type: 'tool_use';
  toolUse: {
    id: string;
    name: string;
  };
}

// Tool input (streaming)
{
  type: 'tool_use_input';
  toolInput: string;
}

// Response complete
{
  type: 'stop';
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
}

// Error occurred
{
  type: 'error';
  error: string;
}
```

### Using wscat

**Install:**
```bash
npm install -g wscat
```

**Connect:**
```bash
wscat -c ws://localhost:18789
```

**Send message:**
```json
{"content":"Hello!","sessionKey":"user-123"}
```

**Response streams:**
```
< {"type":"text","text":"Hey"}
< {"type":"text","text":"."}
< {"type":"text","text":" What"}
< {"type":"text","text":" are"}
< {"type":"text","text":" we"}
< {"type":"text","text":" working"}
< {"type":"text","text":" on"}
< {"type":"text","text":"?"}
< {"type":"stop","stopReason":"end_turn"}
```

### Session Persistence

Use the same `sessionKey` to maintain conversation context:

```javascript
// Message 1
ws.send(JSON.stringify({
  content: 'My name is Alice',
  sessionKey: 'user-123'
}));

// Message 2 (same session)
ws.send(JSON.stringify({
  content: 'What is my name?',
  sessionKey: 'user-123'
}));
// Response: "Your name is Alice"
```

## OpenAI-Compatible API

Drop-in replacement for OpenAI's chat completions API.

### Endpoint

```
POST /v1/chat/completions
```

### Request

**cURL:**
```bash
curl -X POST http://localhost:18789/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [
      {
        "role": "user",
        "content": "Hello!"
      }
    ],
    "stream": false
  }'
```

**Request Body:**
```typescript
{
  model: string;                    // Model name (optional, uses configured)
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  stream?: boolean;                 // Enable streaming (default: false)
  max_tokens?: number;              // Max response tokens
  temperature?: number;             // Temperature (0-1)
  user?: string;                    // User identifier
  session_key?: string;             // Vena-specific: Session persistence
}
```

### Non-Streaming Response

**Response:**
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1707580800,
  "model": "claude-sonnet-4-20250514",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hey. What are we working on?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 8,
    "total_tokens": 18
  }
}
```

### Streaming Response

**Request:**
```bash
curl -X POST http://localhost:18789/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [{"role":"user","content":"Hello!"}],
    "stream": true
  }'
```

**Response (Server-Sent Events):**
```
data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","created":1707580800,"model":"claude-sonnet-4-20250514","choices":[{"index":0,"delta":{"role":"assistant","content":"Hey"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","created":1707580800,"model":"claude-sonnet-4-20250514","choices":[{"index":0,"delta":{"content":"."},"finish_reason":null}]}

data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","created":1707580800,"model":"claude-sonnet-4-20250514","choices":[{"index":0,"delta":{"content":" What"},"finish_reason":null}]}

data: [DONE]
```

### Session Persistence

Use `session_key` to maintain context:

```bash
curl -X POST http://localhost:18789/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "messages": [{"role":"user","content":"My name is Alice"}],
    "session_key": "user-123"
  }'

# Later, same session:
curl -X POST http://localhost:18789/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "messages": [{"role":"user","content":"What is my name?"}],
    "session_key": "user-123"
  }'
# Response: "Your name is Alice"
```

### Python Example

```python
from openai import OpenAI

# Point to Vena instead of OpenAI
client = OpenAI(
    base_url="http://localhost:18789/v1",
    api_key="not-needed"  # Unless auth is enabled
)

response = client.chat.completions.create(
    model="claude-sonnet-4-20250514",
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)

print(response.choices[0].message.content)
```

### JavaScript Example

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:18789/v1',
  apiKey: 'not-needed'  // Unless auth is enabled
});

const response = await client.chat.completions.create({
  model: 'claude-sonnet-4-20250514',
  messages: [
    { role: 'user', content: 'Hello!' }
  ]
});

console.log(response.choices[0].message.content);
```

## Authentication

### API Key Auth

**Enable:**
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

**Usage:**

Via `Authorization` header:
```bash
curl -H 'Authorization: Bearer secret-key-1' \
  http://localhost:18789/api/message
```

Via `X-API-Key` header:
```bash
curl -H 'X-API-Key: secret-key-1' \
  http://localhost:18789/api/message
```

**WebSocket:**
```javascript
const ws = new WebSocket('ws://localhost:18789?apiKey=secret-key-1');
```

Or in message:
```javascript
ws.send(JSON.stringify({
  apiKey: 'secret-key-1',
  content: 'Hello!'
}));
```

### Generate API Keys

**Secure random key:**
```bash
openssl rand -hex 32
# Output: a1b2c3d4e5f6...
```

**UUID:**
```bash
uuidgen
# Output: 123e4567-e89b-12d3-a456-426614174000
```

Use generated keys in config:
```json
{
  "gateway": {
    "auth": {
      "enabled": true,
      "apiKeys": [
        "a1b2c3d4e5f6...",
        "123e4567-e89b-12d3-a456-426614174000"
      ]
    }
  }
}
```

## Rate Limiting

### Configuration

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

- `windowMs` - Time window in milliseconds (default: 60000 = 1 minute)
- `maxRequests` - Max requests per window (default: 120)

### Response

When rate limit exceeded:

**HTTP:**
```
HTTP/1.1 429 Too Many Requests
Content-Type: application/json

{
  "error": "Too many requests. Please try again later."
}
```

**WebSocket:**
Connection closed with reason: `Rate limit exceeded`

### Headers

Response includes rate limit headers:

```
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1707581400
```

## Error Handling

### HTTP Errors

**400 Bad Request:**
```json
{
  "error": "Invalid request body",
  "details": "Missing required field: content"
}
```

**401 Unauthorized:**
```json
{
  "error": "Unauthorized",
  "details": "Invalid or missing API key"
}
```

**413 Payload Too Large:**
```json
{
  "error": "Payload too large",
  "details": "Message exceeds 100KB limit"
}
```

**429 Too Many Requests:**
```json
{
  "error": "Too many requests",
  "details": "Rate limit exceeded. Try again in 30 seconds."
}
```

**500 Internal Server Error:**
```json
{
  "error": "Internal server error",
  "details": "An unexpected error occurred"
}
```

### WebSocket Errors

**Connection failed:**
```javascript
ws.on('error', (error) => {
  console.error('Connection error:', error);
});
```

**Message errors:**
```javascript
ws.on('message', (data) => {
  const chunk = JSON.parse(data);
  if (chunk.type === 'error') {
    console.error('Error:', chunk.error);
  }
});
```

**Rate limit:**
Connection closed with close code `1008` (Policy Violation).

### Retry Strategy

**Exponential backoff:**
```javascript
async function sendWithRetry(message, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch('http://localhost:18789/api/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message)
      });

      if (response.status === 429) {
        const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      return await response.json();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
    }
  }
}
```

## Best Practices

### Session Management

1. Use consistent `sessionKey` for same user
2. Format: `{channel}-{userId}` (e.g., `telegram-12345`)
3. Don't reuse keys across users
4. Clean up old sessions periodically

### Error Handling

1. Always check status codes
2. Implement retry with exponential backoff
3. Handle rate limits gracefully
4. Log errors for debugging

### Performance

1. Use WebSocket for real-time interactions
2. Use HTTP for request-response patterns
3. Enable streaming for long responses
4. Implement client-side caching

### Security

1. Enable authentication in production
2. Use HTTPS (reverse proxy)
3. Rotate API keys periodically
4. Monitor for abuse
5. Set appropriate rate limits

## Examples

### Complete HTTP Client

```typescript
import axios from 'axios';

class VenaClient {
  constructor(
    private baseUrl: string,
    private apiKey?: string
  ) {}

  async sendMessage(content: string, sessionKey: string) {
    const response = await axios.post(
      `${this.baseUrl}/api/message`,
      { content, sessionKey },
      {
        headers: this.apiKey
          ? { 'Authorization': `Bearer ${this.apiKey}` }
          : {}
      }
    );
    return response.data;
  }

  async getStatus() {
    const response = await axios.get(`${this.baseUrl}/api/status`);
    return response.data;
  }

  async getSessions() {
    const response = await axios.get(`${this.baseUrl}/api/sessions`);
    return response.data;
  }
}

// Usage
const client = new VenaClient('http://localhost:18789', 'secret-key-1');
const response = await client.sendMessage('Hello!', 'user-123');
console.log(response.response);
```

### Complete WebSocket Client

```typescript
import WebSocket from 'ws';

class VenaWebSocketClient {
  private ws: WebSocket;

  constructor(url: string, apiKey?: string) {
    const wsUrl = apiKey ? `${url}?apiKey=${apiKey}` : url;
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => console.log('Connected'));
    this.ws.on('close', () => console.log('Disconnected'));
    this.ws.on('error', (error) => console.error('Error:', error));
  }

  sendMessage(content: string, sessionKey: string) {
    this.ws.send(JSON.stringify({ content, sessionKey }));
  }

  onMessage(callback: (chunk: any) => void) {
    this.ws.on('message', (data) => {
      const chunk = JSON.parse(data.toString());
      callback(chunk);
    });
  }

  close() {
    this.ws.close();
  }
}

// Usage
const client = new VenaWebSocketClient('ws://localhost:18789', 'secret-key-1');

client.onMessage((chunk) => {
  if (chunk.type === 'text') {
    process.stdout.write(chunk.text);
  } else if (chunk.type === 'stop') {
    console.log('\nDone');
  }
});

client.sendMessage('Hello!', 'user-123');
```

## Next Steps

- [Getting Started](./getting-started.md) - Start the gateway server
- [Configuration](./configuration.md) - Configure gateway settings
- [Security](./security.md) - API authentication and rate limiting
- [Channels](./channels.md) - Multi-channel setup
