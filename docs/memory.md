# Memory

Memory architecture, knowledge graph, and semantic search in Vena.

## Table of Contents
- [Overview](#overview)
- [Flat File Memory](#flat-file-memory)
- [Semantic Memory](#semantic-memory)
- [Knowledge Graph](#knowledge-graph)
- [Entity Extraction](#entity-extraction)
- [Semantic Index](#semantic-index)
- [Context Ranking](#context-ranking)
- [Memory Consolidation](#memory-consolidation)
- [Shared Memory](#shared-memory)
- [Configuration](#configuration)

## Overview

Vena supports two memory modes:

**Flat File** (default)
- Daily logs stored as Markdown
- `MEMORY.md` long-term summary
- Simple search by text match

**Semantic Memory** (recommended)
- Knowledge graph stored in SQLite
- Entity and relationship extraction
- Embedding-based similarity search
- Automatic memory consolidation
- Context-aware recall

Both modes gracefully degrade: if semantic memory fails, Vena falls back to flat file.

## Flat File Memory

### Structure

```
~/.vena/memory/
├── daily-log-2025-02-10.md
├── daily-log-2025-02-11.md
└── MEMORY.md
```

### Daily Logs

Each conversation turn is logged:

```markdown
## 2025-02-10T14:30:00Z

**User:** How do I set up Vena?

**Assistant:** To set up Vena, run `vena onboard` and follow the wizard...

---
```

### Long-Term Memory

`MEMORY.md` stores important facts extracted from conversations:

```markdown
# Long-Term Memory

## User Information
- Name: Alex
- Role: Senior Engineer
- Prefers TypeScript
- Works on AI agents

## Projects
- vena: AI agent platform, TypeScript monorepo
- personal-site: Portfolio website

## Preferences
- Concise responses preferred
- Dislikes verbose explanations
```

### Search

Simple text matching:
```typescript
memoryManager.search('TypeScript projects')
```

Returns: Matching log entries and long-term facts.

## Semantic Memory

Advanced memory system with knowledge graph and embeddings.

### Architecture

```
┌─────────────────┐
│  Conversation   │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ EntityExtractor │ ──> Extract entities and relationships
└────────┬────────┘
         │
         v
┌─────────────────┐
│ KnowledgeGraph  │ ──> Store in SQLite (nodes + edges)
└────────┬────────┘
         │
         v
┌─────────────────┐
│ SemanticIndex   │ ──> Generate embeddings for search
└────────┬────────┘
         │
         v
┌─────────────────┐
│ ContextRanker   │ ──> Rank by relevance when recalling
└─────────────────┘
```

### Enable

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
    }
  }
}
```

## Knowledge Graph

SQLite-backed graph database storing entities and relationships.

### Schema

**Entities:**
```sql
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  type TEXT,
  name TEXT,
  attributes TEXT,
  embedding BLOB,
  firstSeen TEXT,
  lastSeen TEXT,
  mentionCount INTEGER,
  confidence REAL
);
```

**Relationships:**
```sql
CREATE TABLE relationships (
  id TEXT PRIMARY KEY,
  sourceId TEXT,
  targetId TEXT,
  type TEXT,
  weight REAL,
  context TEXT,
  timestamp TEXT
);
```

### Entity Types

- `person` - People mentioned in conversations
- `project` - Software projects, codebases
- `concept` - Technical concepts, ideas
- `place` - Locations
- `file` - Files, documents
- `event` - Events, meetings
- `custom` - User-defined types

### Example Graph

After conversation:
```
User: I'm working on the Vena project with Markus. It's a TypeScript
      monorepo for AI agents.
```

**Entities created:**
1. `person:user` - User
2. `person:Markus` - Collaborator
3. `project:Vena` - Project
4. `concept:TypeScript` - Language
5. `concept:monorepo` - Architecture
6. `concept:AI-agents` - Domain

**Relationships created:**
1. `user -> works_on -> Vena`
2. `user -> collaborates_with -> Markus`
3. `Vena -> uses_language -> TypeScript`
4. `Vena -> architecture -> monorepo`
5. `Vena -> domain -> AI-agents`

### Queries

**Get entity:**
```typescript
await knowledgeGraph.getEntity('project:Vena');
```

**Get relationships:**
```typescript
await knowledgeGraph.getRelationships('user', 'works_on');
```

**Graph traversal:**
```typescript
await knowledgeGraph.traverseBFS('user', 2); // 2 hops
```

**Shortest path:**
```typescript
await knowledgeGraph.shortestPath('user', 'TypeScript');
```

### Storage

```
~/.vena/knowledge/
└── graph.db     # SQLite database
```

## Entity Extraction

Automatically extracts entities and relationships from conversations.

### Process

1. Agent responds to user
2. `EntityExtractor` analyzes conversation turn
3. Entities identified with confidence scores
4. Relationships inferred from context
5. Entities and relationships saved to knowledge graph

### Example

**Input:**
```
User: Can you help me deploy my React app to Vercel?
```

**Extracted:**
- Entity: `project:React-app` (confidence: 0.9)
- Entity: `platform:Vercel` (confidence: 0.95)
- Entity: `person:user` (confidence: 1.0)
- Relationship: `user -> owns -> React-app` (weight: 0.9)
- Relationship: `React-app -> deployed_to -> Vercel` (weight: 0.8)

### Configuration

```json
{
  "memory": {
    "semanticMemory": {
      "entityExtraction": true
    }
  }
}
```

## Semantic Index

Embedding-based search for similarity matching.

### How It Works

1. Each entity gets an embedding vector (1536 dimensions for Anthropic)
2. User query converted to embedding
3. Cosine similarity computed between query and all entities
4. Top-k most similar entities returned

### Example

**Query:** "Tell me about my TypeScript projects"

**Process:**
1. Query → embedding vector
2. Compare with all entity embeddings
3. Top matches:
   - `project:Vena` (similarity: 0.92)
   - `project:personal-site` (similarity: 0.78)
   - `concept:TypeScript` (similarity: 0.85)

### Provider

Uses configured embedding provider:
```json
{
  "memory": {
    "embeddingProvider": "anthropic"
  }
}
```

Options:
- `anthropic` - Voyage embeddings via Anthropic API
- `openai` - `text-embedding-3-small`

## Context Ranking

Ranks recalled memories by relevance to current conversation.

### Factors

1. **Recency** - More recent = higher rank
2. **Relevance** - Semantic similarity to query
3. **Importance** - Entity mention count
4. **Confidence** - Extraction confidence score
5. **Graph distance** - Closer in graph = higher rank

### Example

**Query:** "What did I work on yesterday?"

**Recalled context (ranked):**
1. `project:Vena` (worked on yesterday, high relevance)
2. `person:Markus` (mentioned yesterday in context)
3. `concept:TypeScript` (related to Vena, lower rank)

Agent receives top-ranked context in system prompt.

## Memory Consolidation

Automatically merges and summarizes memories over time.

### Process

1. Triggered every 24 hours (configurable)
2. Identifies duplicate or similar entities
3. Merges entities with high similarity
4. Updates relationship weights
5. Archives old daily logs
6. Updates long-term memory summary

### Benefits

- Reduces memory bloat
- Improves search quality
- Maintains knowledge consistency
- Compacts storage

### Configuration

```json
{
  "memory": {
    "semanticMemory": {
      "autoConsolidate": true,
      "consolidateInterval": "24h"
    }
  }
}
```

Intervals:
- `1h` - Hourly
- `24h` - Daily (recommended)
- `7d` - Weekly

### Manual Trigger

Coming soon:
```bash
vena memory consolidate
```

## Shared Memory

Allow agents to share knowledge across the mesh network.

### Configuration

```json
{
  "memory": {
    "sharedMemory": {
      "enabled": true,
      "crossAgentSearch": true
    }
  }
}
```

### How It Works

**Without shared memory:**
- Each agent has isolated knowledge graph
- Agent A's knowledge is invisible to Agent B

**With shared memory:**
- All agents read/write to shared knowledge graph
- Agent A extracts entity → Agent B can recall it
- Consistent knowledge across the mesh

### Example

```
User -> Agent A: My name is Alex and I work on Vena
Agent A extracts: person:Alex, project:Vena

[Later, different session]
User -> Agent B: What do I work on?
Agent B recalls from shared memory: project:Vena
Agent B: You work on Vena
```

### Access Control

Coming soon - memory namespaces and ACLs:
```json
{
  "memory": {
    "sharedMemory": {
      "enabled": true,
      "acl": {
        "agent1": ["read", "write"],
        "agent2": ["read"]
      }
    }
  }
}
```

## Configuration

### Full Example

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

### Disable Semantic Memory

```json
{
  "memory": {
    "semanticMemory": {
      "enabled": false
    }
  }
}
```

Falls back to flat file mode.

### Disable Specific Features

```json
{
  "memory": {
    "semanticMemory": {
      "enabled": true,
      "entityExtraction": true,
      "knowledgeGraph": true,
      "autoConsolidate": false
    }
  }
}
```

## Storage Locations

### Flat File

```
~/.vena/memory/
├── daily-log-YYYY-MM-DD.md
└── MEMORY.md
```

### Semantic Memory

```
~/.vena/knowledge/
└── graph.db
```

### Session History

```
~/.vena/sessions/
├── telegram-12345.json
├── http-session-abc.json
└── websocket-xyz.json
```

## API

### Memory Manager

```typescript
import { MemoryManager } from '@vena/core';

const memoryManager = new MemoryManager(config, semanticProvider);

// Log conversation
await memoryManager.log(sessionId, message);

// Search memory
const results = await memoryManager.search(query);

// Get context for prompt
const context = await memoryManager.recall(query, limit);
```

### Knowledge Graph

```typescript
import { KnowledgeGraph } from '@vena/semantic-memory';

const graph = new KnowledgeGraph(dbPath);

// Add entity
await graph.addEntity({
  id: 'project:Vena',
  type: 'project',
  name: 'Vena',
  attributes: { language: 'TypeScript' },
  confidence: 0.95
});

// Add relationship
await graph.addRelationship({
  sourceId: 'user',
  targetId: 'project:Vena',
  type: 'works_on',
  weight: 0.9
});

// Query
const entity = await graph.getEntity('project:Vena');
const related = await graph.getRelationships('user', 'works_on');
```

## Best Practices

### Enable Semantic Memory

Unless you have specific reasons not to, enable semantic memory:
```json
{
  "memory": {
    "semanticMemory": {
      "enabled": true
    }
  }
}
```

Benefits:
- Better context recall
- Automatic entity extraction
- Graph-based knowledge representation
- Similarity search

### Set Consolidation Interval

Daily consolidation is recommended:
```json
{
  "memory": {
    "semanticMemory": {
      "consolidateInterval": "24h"
    }
  }
}
```

### Use Shared Memory for Multi-Agent

If running multiple agents, enable shared memory:
```json
{
  "memory": {
    "sharedMemory": {
      "enabled": true
    }
  }
}
```

### Monitor Storage

Check disk usage periodically:
```bash
du -sh ~/.vena/knowledge
du -sh ~/.vena/memory
```

### Backup Knowledge Graph

Backup the SQLite database:
```bash
cp ~/.vena/knowledge/graph.db ~/.vena/knowledge/graph.db.backup
```

## Troubleshooting

### Semantic Memory Not Working

Check logs for errors:
```bash
vena start 2>&1 | grep -i memory
```

Common issues:
- Missing embedding provider API key
- SQLite not installed
- Disk space exhausted

Falls back to flat file mode on error.

### High Memory Usage

If memory usage is high:
1. Reduce consolidation interval
2. Limit entity count
3. Archive old knowledge graphs

Coming soon:
```bash
vena memory prune --older-than 30d
```

### Slow Context Recall

If recall is slow:
1. Check knowledge graph size: `ls -lh ~/.vena/knowledge/graph.db`
2. Run consolidation: `vena memory consolidate` (coming soon)
3. Reduce embedding dimensions (provider-dependent)
4. Disable cross-agent search if not needed

### Lost Memory After Update

Memory is preserved across updates. If you lose memory:
1. Check `~/.vena/memory/` and `~/.vena/knowledge/` exist
2. Verify file permissions
3. Restore from backup

## Advanced Topics

### Custom Entity Types

Coming soon - define custom entity types:
```json
{
  "memory": {
    "semanticMemory": {
      "customEntityTypes": [
        {
          "type": "customer",
          "attributes": ["company", "tier", "mrr"]
        }
      ]
    }
  }
}
```

### Memory Namespaces

Isolate memory per agent:
```json
{
  "agents": {
    "registry": [
      {
        "id": "personal",
        "memoryNamespace": "personal"
      },
      {
        "id": "work",
        "memoryNamespace": "work"
      }
    ]
  }
}
```

Separate knowledge graphs per namespace.

### Export Knowledge Graph

Coming soon:
```bash
vena memory export --format json > knowledge.json
vena memory export --format cypher > knowledge.cypher
```

### Import Knowledge Graph

Coming soon:
```bash
vena memory import knowledge.json
```

## Next Steps

- [Agents Guide](./agents.md) - Configure per-agent memory
- [Configuration](./configuration.md) - Full memory config reference
- [Getting Started](./getting-started.md) - Enable semantic memory
