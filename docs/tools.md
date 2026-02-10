# Tools

Available tools and trust level requirements for Vena agents.

## Table of Contents
- [Overview](#overview)
- [Tool List](#tool-list)
- [Bash Tool](#bash-tool)
- [Read Tool](#read-tool)
- [Write Tool](#write-tool)
- [Edit Tool](#edit-tool)
- [Web Browse Tool](#web-browse-tool)
- [Browser Tool](#browser-tool)
- [Google Tool](#google-tool)
- [Trust Levels](#trust-levels)
- [Docker Sandbox](#docker-sandbox)

## Overview

Vena agents have access to tools for interacting with the system, web, and external services. Tool access is controlled by **trust levels** enforced by `ToolGuard`.

**Security features:**
- Trust level enforcement
- Path validation (blocks `.env`, `.ssh`, traversal attacks)
- URL validation (blocks private IPs)
- Command allowlisting
- Environment sanitization

## Tool List

| Tool | Description | Trust Level |
|------|-------------|-------------|
| `bash` | Execute shell commands | `full` |
| `read` | Read files from filesystem | `readonly`, `limited`, `full` |
| `write` | Write files to filesystem | `limited`, `full` |
| `edit` | Edit existing files | `limited`, `full` |
| `web_browse` | Fetch web pages | `readonly`, `limited`, `full` |
| `browser` | Playwright browser automation | `limited`, `full` |
| `google` | Google Workspace integration | `limited`, `full` |

## Bash Tool

Execute shell commands.

### Trust Level

`full` only

### Usage

```
bash: Execute a shell command
Input:
  command (string): The shell command to execute
  workingDir (string, optional): Working directory

Output: stdout, stderr, exit code
```

### Examples

```bash
git status
npm install
ls -la
find . -name "*.ts"
```

### Security

**Command Allowlist:**
Default allowed commands (configurable):
```json
{
  "security": {
    "shell": {
      "allowedCommands": [
        "git", "npm", "pnpm", "node", "npx",
        "ls", "cat", "find", "grep", "pwd"
      ]
    }
  }
}
```

Commands not in allowlist are blocked.

**Environment Sanitization:**
Only safe env vars are passed to subprocess:
```json
{
  "security": {
    "shell": {
      "envPassthrough": [
        "PATH", "HOME", "USER", "SHELL", "LANG", "NODE_ENV"
      ]
    }
  }
}
```

API keys and secrets are stripped.

### Configuration

Enable/disable:
```json
{
  "computer": {
    "shell": {
      "enabled": true,
      "allowedCommands": ["git", "npm", "node"]
    }
  }
}
```

## Read Tool

Read files from the filesystem.

### Trust Level

`readonly`, `limited`, `full`

### Usage

```
read: Read a file
Input:
  path (string): File path to read
  encoding (string, optional): File encoding (default: utf-8)

Output: File contents
```

### Examples

```
Read: /Users/alice/project/README.md
Read: ./src/config.ts
Read: ~/.vena/vena.json
```

### Security

**Blocked Patterns:**
These files/patterns are always blocked:
- `.env`, `.env.*`
- `.ssh/`, `.ssh/*`
- `.aws/`, `.aws/*`
- `.git/config`
- Private keys (`*.pem`, `*.key`)

**Workspace Validation:**
Reads are restricted to allowed workspace roots (configurable).

**Path Traversal Protection:**
Attempts to use `../` to escape workspace are blocked.

### Configuration

```json
{
  "security": {
    "pathPolicy": {
      "blockedPatterns": [
        ".env",
        ".ssh",
        ".aws",
        ".git/config"
      ]
    }
  }
}
```

## Write Tool

Write files to the filesystem.

### Trust Level

`limited`, `full`

### Usage

```
write: Write content to a file
Input:
  path (string): File path to write
  content (string): Content to write
  encoding (string, optional): File encoding (default: utf-8)

Output: Success message
```

### Examples

```
Write: ./output.txt
Content: Hello, world!

Write: ./data.json
Content: {"key": "value"}
```

### Security

Same path validation as `read`:
- Blocked patterns enforced
- Workspace validation
- No path traversal

## Edit Tool

Edit existing files (find and replace).

### Trust Level

`limited`, `full`

### Usage

```
edit: Edit a file
Input:
  path (string): File path to edit
  oldText (string): Text to find
  newText (string): Text to replace with

Output: Success message with changes made
```

### Examples

```
Edit: ./src/config.ts
Old: const port = 3000;
New: const port = 8080;
```

### Security

Same path validation as `read` and `write`.

## Web Browse Tool

Fetch web pages via HTTP/HTTPS.

### Trust Level

`readonly`, `limited`, `full`

### Usage

```
web_browse: Fetch a web page
Input:
  url (string): URL to fetch
  method (string, optional): HTTP method (default: GET)
  headers (object, optional): Custom headers
  body (string, optional): Request body

Output: Response body, status code, headers
```

### Examples

```
Fetch: https://api.github.com/repos/Codevena/Vena
Fetch: https://example.com
```

### Security

**URL Validation:**
- Must be `http://` or `https://`
- Private IP ranges blocked by default:
  - `127.0.0.0/8` (localhost)
  - `10.0.0.0/8` (private)
  - `172.16.0.0/12` (private)
  - `192.168.0.0/16` (private)
  - `169.254.0.0/16` (link-local)

**Override (not recommended):**
```json
{
  "security": {
    "urlPolicy": {
      "allowPrivateIPs": true
    }
  }
}
```

### Configuration

Always enabled if agent has `readonly` or higher trust.

## Browser Tool

Playwright-powered browser automation.

### Trust Level

`limited`, `full`

### Usage

```
browser: Control a web browser
Input:
  action (string): Action to perform
    - navigate: Go to URL
    - click: Click element
    - type: Type text
    - screenshot: Capture screenshot
    - evaluate: Run JavaScript
  url (string, optional): URL for navigate
  selector (string, optional): CSS selector for click/type
  text (string, optional): Text for type
  script (string, optional): JavaScript for evaluate

Output: Action result, screenshots
```

### Examples

```
Action: navigate
URL: https://github.com/Codevena/Vena

Action: click
Selector: button[aria-label="Star"]

Action: type
Selector: input[name="q"]
Text: AI agents

Action: screenshot

Action: evaluate
Script: document.title
```

### Security

- Same URL validation as `web_browse`
- JavaScript execution is sandboxed in browser context
- Screenshots are limited to visible viewport

### Configuration

```json
{
  "computer": {
    "browser": {
      "enabled": true,
      "headless": false
    }
  }
}
```

**Headless mode:**
- `false` - Browser window visible (useful for debugging)
- `true` - Headless (faster, production use)

## Google Tool

Google Workspace integration via OAuth.

### Trust Level

`limited`, `full`

### Usage

```
google: Access Google Workspace
Input:
  service (string): Google service
    - gmail: Email
    - calendar: Calendar events
    - drive: File management
    - docs: Document editing
    - sheets: Spreadsheet operations
  action (string): Action to perform
  parameters (object): Action-specific params

Output: Action result
```

### Examples

**Gmail:**
```
Service: gmail
Action: list
Parameters: { maxResults: 10, q: "is:unread" }

Service: gmail
Action: send
Parameters: {
  to: "user@example.com",
  subject: "Hello",
  body: "Hi there!"
}
```

**Calendar:**
```
Service: calendar
Action: list_events
Parameters: { timeMin: "2025-01-01T00:00:00Z" }

Service: calendar
Action: create_event
Parameters: {
  summary: "Meeting",
  start: "2025-02-15T10:00:00Z",
  end: "2025-02-15T11:00:00Z"
}
```

**Drive:**
```
Service: drive
Action: list
Parameters: { pageSize: 10 }

Service: drive
Action: upload
Parameters: {
  name: "document.pdf",
  mimeType: "application/pdf",
  content: "<base64>"
}
```

**Docs:**
```
Service: docs
Action: create
Parameters: { title: "New Document" }

Service: docs
Action: append_text
Parameters: {
  documentId: "abc123",
  text: "Hello, world!"
}
```

**Sheets:**
```
Service: sheets
Action: create
Parameters: { title: "New Spreadsheet" }

Service: sheets
Action: update
Parameters: {
  spreadsheetId: "abc123",
  range: "Sheet1!A1:B2",
  values: [["Name", "Age"], ["Alice", "30"]]
}
```

### Security

- OAuth 2.0 authentication required
- Scopes requested: `gmail`, `calendar`, `drive`, `docs`, `sheets`
- Tokens stored in config
- Auto-refresh on expiry

### Configuration

```json
{
  "google": {
    "clientId": "${GOOGLE_CLIENT_ID}",
    "clientSecret": "${GOOGLE_CLIENT_SECRET}",
    "scopes": ["gmail", "docs", "sheets", "calendar", "drive"]
  }
}
```

### Setup

Coming soon:
```bash
vena config google-auth
```

This will open OAuth flow in browser and save tokens to config.

## Trust Levels

Control which tools each agent can access.

### Full

All tools enabled:
- `bash` - Shell execution
- `read` - Read files
- `write` - Write files
- `edit` - Edit files
- `web_browse` - Fetch web pages
- `browser` - Browser automation
- `google` - Google Workspace

**Use for:**
- Primary assistant agents
- Fully trusted agents
- Agents that need complete system access

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

### Limited

No shell access:
- `read` - Read files
- `write` - Write files
- `edit` - Edit files
- `web_browse` - Fetch web pages
- `browser` - Browser automation
- `google` - Google Workspace

**Use for:**
- Specialized agents (research, analysis)
- Agents exposed to semi-trusted users
- Default recommendation

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

### Readonly

Read-only access:
- `read` - Read files
- `web_browse` - Fetch web pages

**Use for:**
- Experimental agents
- Agents exposed to untrusted users
- Read-only analysis tasks

**Configuration:**
```json
{
  "agents": {
    "registry": [
      {
        "id": "assistant",
        "trustLevel": "readonly"
      }
    ]
  }
}
```

### Comparison

| Tool | Readonly | Limited | Full |
|------|----------|---------|------|
| bash | No | No | Yes |
| read | Yes | Yes | Yes |
| write | No | Yes | Yes |
| edit | No | Yes | Yes |
| web_browse | Yes | Yes | Yes |
| browser | No | Yes | Yes |
| google | No | Yes | Yes |

## Docker Sandbox

Run tools in isolated Docker containers for maximum security.

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

### Fields

**`enabled`** (boolean, default: `false`)
- Enable Docker sandbox

**`image`** (string, default: `"node:22-slim"`)
- Docker image to use

**`memoryLimit`** (string, default: `"512m"`)
- Memory limit per container

**`cpuLimit`** (string, default: `"1.0"`)
- CPU limit (1.0 = 1 core)

**`network`** (enum, default: `"none"`)
- Network mode:
  - `none` - No network access (most secure)
  - `host` - Host network
  - `bridge` - Bridge network

**`readOnlyRoot`** (boolean, default: `true`)
- Mount root filesystem as read-only

### Benefits

- Complete isolation from host system
- Resource limits (memory, CPU)
- Network isolation (optional)
- Read-only root filesystem
- Automatic cleanup

### Trade-offs

- Slower execution (container overhead)
- Requires Docker installed
- More complex debugging
- Limited filesystem access

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
      "memoryLimit": "256m"
    }
  }
}
```

Agent can execute bash but has no network access and limited memory.

## Best Practices

### Trust Level Selection

1. Start with `limited` as default
2. Use `full` only for primary, trusted agents
3. Use `readonly` for experimental features
4. Never use `full` for user-facing public agents

### Path Security

1. Don't disable path validation
2. Keep blocked patterns comprehensive
3. Restrict workspace roots to project directories
4. Audit file access regularly

### URL Security

1. Keep private IP blocking enabled
2. Validate URLs before opening in browser
3. Be cautious with user-provided URLs
4. Use Docker sandbox for untrusted web browsing

### Shell Security

1. Minimize allowed commands
2. Don't allow `rm`, `sudo`, `curl | bash`
3. Sanitize environment variables
4. Use Docker sandbox for untrusted execution
5. Audit shell command logs

### Google Workspace

1. Use least privilege scopes
2. Rotate OAuth tokens periodically
3. Monitor API usage in Google Cloud Console
4. Consider separate service accounts per agent

## Troubleshooting

### Tool Blocked by Trust Level

```
Error: Tool 'bash' requires trust level 'full' but agent has 'limited'
```

**Solution:**
Increase agent's trust level:
```json
{
  "agents": {
    "registry": [
      { "id": "main", "trustLevel": "full" }
    ]
  }
}
```

### Path Blocked

```
Error: Path '/Users/alice/.env' matches blocked pattern '.env'
```

**Solution:**
Don't read sensitive files. This is working as intended.

### Command Not Allowed

```
Error: Command 'curl' not in allowed list
```

**Solution:**
Add to allowlist:
```json
{
  "security": {
    "shell": {
      "allowedCommands": ["git", "npm", "curl"]
    }
  }
}
```

Or use `web_browse` tool instead.

### Private IP Blocked

```
Error: URL 'http://192.168.1.1' contains private IP
```

**Solution (not recommended):**
```json
{
  "security": {
    "urlPolicy": {
      "allowPrivateIPs": true
    }
  }
}
```

### Google OAuth Required

```
Error: Google Workspace requires OAuth authentication
```

**Solution:**
Run OAuth flow:
```bash
vena config google-auth
```

## Next Steps

- [Security Guide](./security.md) - Understand ToolGuard enforcement
- [Agents Guide](./agents.md) - Configure per-agent trust levels
- [Configuration](./configuration.md) - Full security config reference
