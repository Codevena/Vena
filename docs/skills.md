# Skills

Custom skill system for extending agent capabilities.

## Table of Contents
- [Overview](#overview)
- [SKILL.md Format](#skillmd-format)
- [Skill Loading](#skill-loading)
- [Creating Skills](#creating-skills)
- [Installing Skills](#installing-skills)
- [Eligibility Requirements](#eligibility-requirements)
- [Skill Commands](#skill-commands)
- [Best Practices](#best-practices)

## Overview

Vena's skill system allows you to extend agent capabilities with custom instructions, tools, and behaviors.

**Features:**
- SKILL.md format with YAML frontmatter
- Three skill sources: bundled, managed, workspace
- Eligibility gating (OS, binaries, env vars, config)
- XML-escaped injection (prevents prompt injection)
- User-invocable slash commands
- Model auto-invocation control

## SKILL.md Format

Skills are defined in Markdown files with YAML frontmatter.

### Basic Structure

```markdown
---
name: summarize
version: 1.0.0
description: Summarize long text into concise bullet points
triggers:
  - summarize
  - summary
  - tldr
enabled: true
---

# Summarization Skill

When the user asks you to summarize text, follow these rules:

1. Read the full text carefully
2. Extract key points
3. Present as concise bullet points
4. Preserve important details
5. Remove filler and redundancy

## Format

- Start with a one-sentence overview
- Follow with 3-7 bullet points
- Each bullet: one key insight
- End with a conclusion if needed
```

### Full Example

```markdown
---
name: code-review
version: 1.2.0
description: Perform thorough code reviews with security and best practice checks
triggers:
  - code review
  - review code
  - cr
command: /review
userInvocable: true
enabled: true
os:
  - darwin
  - linux
requires:
  bins:
    - git
  env:
    - GITHUB_TOKEN
  config:
    - providers.anthropic.apiKey
---

# Code Review Skill

## Overview

Perform comprehensive code reviews focusing on:
- Security vulnerabilities
- Performance issues
- Best practices
- Code style
- Test coverage

## Process

1. **Read the code** using the `read` tool
2. **Analyze** for issues in these categories:
   - Security (SQL injection, XSS, secrets in code)
   - Performance (N+1 queries, inefficient algorithms)
   - Maintainability (complex functions, unclear naming)
   - Testing (missing tests, low coverage)
3. **Provide feedback** in this format:
   ```
   ## Code Review: [filename]

   ### Critical Issues (fix immediately)
   - Issue 1
   - Issue 2

   ### Suggestions (consider addressing)
   - Suggestion 1
   - Suggestion 2

   ### Positive Notes
   - What's done well
   ```

## Tools Used

- `read` - Read code files
- `bash` - Run linters, tests
- `web_browse` - Check documentation

## Example Usage

User: `/review src/auth.ts`
```

### Frontmatter Fields

**Required:**

- `name` (string) - Unique skill identifier (alphanumeric + hyphens)
- `version` (string) - Semantic version (e.g., `1.0.0`)
- `description` (string) - Brief description (max 200 chars)
- `triggers` (array) - Phrases that activate this skill
- `enabled` (boolean) - Enable/disable skill

**Optional:**

- `command` (string) - Slash command (e.g., `/summarize`)
- `userInvocable` (boolean) - Allow users to invoke with slash command
- `disableModelInvocation` (boolean) - Prevent auto-invocation by model
- `os` (array) - Platform filter: `darwin`, `linux`, `win32`
- `requires` (object) - Eligibility requirements (see below)

## Skill Loading

Skills are loaded from three sources:

### 1. Bundled Skills

Shipped with Vena in `apps/cli/skills/`:

```
apps/cli/skills/
├── summarize/SKILL.md
├── code-review/SKILL.md
└── research/SKILL.md
```

**Location:** Included in npm package

**Management:** Updated with Vena releases

### 2. Managed Skills

Installed by users to `~/.vena/skills/`:

```
~/.vena/skills/
├── my-custom-skill/SKILL.md
├── another-skill/SKILL.md
```

**Location:** `~/.vena/skills/`

**Management:** Installed via `vena skill install`

### 3. Workspace Skills

Project-specific skills in current working directory:

```
./skills/
├── project-specific/SKILL.md
```

**Location:** Configured in `vena.json`:
```json
{
  "skills": {
    "dirs": ["./skills", "./custom-skills"]
  }
}
```

**Management:** Committed to project repository

### Loading Order

1. Bundled skills loaded first
2. Managed skills loaded second (can override bundled)
3. Workspace skills loaded last (can override both)

If multiple skills have the same `name`, last loaded wins.

## Creating Skills

### Step 1: Create SKILL.md

```bash
mkdir -p ./skills/my-skill
nano ./skills/my-skill/SKILL.md
```

### Step 2: Define Frontmatter

```yaml
---
name: my-skill
version: 1.0.0
description: Does something useful
triggers:
  - do the thing
  - perform action
enabled: true
---
```

### Step 3: Write Instructions

```markdown
# My Skill

When the user asks you to "do the thing", follow these steps:

1. First step
2. Second step
3. Third step
```

### Step 4: Test Locally

```bash
vena skill validate ./skills/my-skill/SKILL.md
```

### Step 5: Configure Vena

```json
{
  "skills": {
    "dirs": ["./skills"]
  }
}
```

### Step 6: Use Skill

```bash
vena chat

> do the thing
```

## Installing Skills

### Install from File

```bash
vena skill install ./path/to/SKILL.md
```

Copies to `~/.vena/skills/[skill-name]/SKILL.md`.

### Install from URL

Coming soon:
```bash
vena skill install https://example.com/skills/my-skill.md
```

### Install from Registry

Coming soon:
```bash
vena skill install @vena/code-review
```

### List Installed

```bash
vena skill list
```

Output:
```
Bundled Skills:
  • summarize (1.0.0) - Summarize long text
  • code-review (1.2.0) - Perform code reviews

Managed Skills:
  • my-skill (1.0.0) - Does something useful

Workspace Skills:
  • project-skill (1.0.0) - Project-specific skill
```

### Uninstall

```bash
vena skill uninstall my-skill
```

## Eligibility Requirements

Skills can declare requirements. If not met, skill is not loaded.

### Binary Requirements

**All binaries must exist:**
```yaml
requires:
  bins:
    - git
    - docker
```

**At least one must exist:**
```yaml
requires:
  anyBins:
    - npm
    - pnpm
    - yarn
```

### Environment Variables

```yaml
requires:
  env:
    - GITHUB_TOKEN
    - OPENAI_API_KEY
```

All listed env vars must be set.

### Config Paths

```yaml
requires:
  config:
    - providers.anthropic.apiKey
    - google.clientId
```

Config paths checked with dot notation. All must exist.

### Platform Filter

```yaml
os:
  - darwin
  - linux
```

Skill only loaded on macOS or Linux.

### Example: Docker Skill

```yaml
---
name: docker-deploy
version: 1.0.0
description: Deploy using Docker
requires:
  bins:
    - docker
    - docker-compose
  env:
    - DOCKER_HOST
os:
  - linux
enabled: true
---
```

This skill requires:
- `docker` and `docker-compose` binaries
- `DOCKER_HOST` environment variable
- Linux platform

If any requirement fails, skill is skipped.

## Skill Commands

### Validate

```bash
vena skill validate ./skills/my-skill/SKILL.md
```

Checks:
- Valid YAML frontmatter
- Required fields present
- Name format (alphanumeric + hyphens only)
- Description length (max 200 chars)
- Triggers not empty
- Content not too large (max 100 KB)

### List

```bash
vena skill list
```

Shows all loaded skills with source.

### Info

Coming soon:
```bash
vena skill info code-review
```

Show full skill details.

### Enable/Disable

Coming soon:
```bash
vena skill disable code-review
vena skill enable code-review
```

### Update

Coming soon:
```bash
vena skill update code-review
```

## Best Practices

### Naming

- Use lowercase with hyphens: `code-review`, `summarize`
- Be descriptive: `git-commit-message`, not `gcm`
- Avoid conflicts with existing skills

### Triggers

- Be specific: `summarize text`, not just `text`
- Provide multiple variations:
  ```yaml
  triggers:
    - summarize
    - summary
    - tldr
    - give me the gist
  ```
- Avoid overly broad triggers: `help` triggers too often

### Instructions

- Be clear and concise
- Use numbered steps
- Provide examples
- Specify output format
- Mention tools to use

### Version Semantic Versioning

- `1.0.0` - Initial release
- `1.1.0` - Add features (backward compatible)
- `2.0.0` - Breaking changes

### Testing

1. Validate with `vena skill validate`
2. Test in `vena chat`
3. Try edge cases
4. Verify eligibility checks work

### Security

- Don't include secrets in SKILL.md
- Use environment variables for API keys
- Be cautious with shell commands
- Validate user input in instructions

### Documentation

Include in SKILL.md:
- Overview of what skill does
- Step-by-step process
- Tools used
- Example usage
- Limitations

## Advanced Topics

### Slash Commands

Make skill user-invocable:

```yaml
---
name: my-skill
command: /myskill
userInvocable: true
---
```

User can invoke with:
```
> /myskill arg1 arg2
```

### Disable Auto-Invocation

Prevent model from auto-triggering:

```yaml
---
name: my-skill
command: /myskill
userInvocable: true
disableModelInvocation: true
---
```

Skill only runs when user explicitly calls `/myskill`.

### Tool Definitions

Coming soon - define custom tools in frontmatter:

```yaml
---
name: my-skill
tools:
  - name: my_tool
    description: Does something
    inputSchema:
      type: object
      properties:
        arg1:
          type: string
---
```

### Conditional Loading

```yaml
---
name: production-skill
requires:
  env:
    - NODE_ENV=production
---
```

Only loads in production.

### Skill Composition

Reference other skills:

```markdown
# Complex Skill

This skill combines:
- summarize skill (for text summary)
- code-review skill (for code analysis)

Process:
1. Use summarize to understand context
2. Use code-review to analyze code
3. Combine insights
```

## Example Skills

### Summarization

```markdown
---
name: summarize
version: 1.0.0
description: Summarize long text into bullet points
triggers:
  - summarize
  - summary
  - tldr
enabled: true
---

# Summarization

Create concise summaries:
1. Read full text
2. Extract key points (3-7 bullets)
3. One sentence per bullet
4. Preserve critical details
```

### Git Commit Messages

```markdown
---
name: git-commit
version: 1.0.0
description: Generate conventional commit messages
triggers:
  - commit message
  - write commit
command: /commit
requires:
  bins:
    - git
enabled: true
---

# Git Commit Message Generator

Generate conventional commit messages:

## Format

```
type(scope): description

[optional body]

[optional footer]
```

## Types
- feat: New feature
- fix: Bug fix
- docs: Documentation
- refactor: Code refactoring
- test: Tests
- chore: Maintenance

## Process
1. Run `git diff --cached`
2. Analyze changes
3. Generate commit message
4. Ask for confirmation
```

### Research Assistant

```markdown
---
name: research
version: 1.0.0
description: Conduct thorough research on topics
triggers:
  - research
  - investigate
  - learn about
enabled: true
---

# Research Assistant

Conduct comprehensive research:

1. **Understand Topic**
   - Clarify scope
   - Identify key questions

2. **Gather Information**
   - Use web_browse for sources
   - Check multiple perspectives
   - Verify facts

3. **Synthesize**
   - Organize findings
   - Highlight key insights
   - Note contradictions

4. **Present**
   ```
   # Research: [Topic]

   ## Summary
   [One paragraph overview]

   ## Key Findings
   - Finding 1
   - Finding 2

   ## Sources
   - [Source 1](url)
   - [Source 2](url)
   ```
```

## Configuration

```json
{
  "skills": {
    "dirs": ["./skills", "./team-skills"],
    "managed": "~/.vena/skills"
  }
}
```

## Next Steps

- [Tools Guide](./tools.md) - Available tools for skills
- [Agents Guide](./agents.md) - Per-agent skill access
- [Configuration](./configuration.md) - Full skills config
