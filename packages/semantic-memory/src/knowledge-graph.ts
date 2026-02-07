import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type { Entity, Relationship } from '@vena/shared';
import { MemoryError } from '@vena/shared';

// ─── Extended Types ─────────────────────────────────────────────────────────

export interface EntityTimeline {
  entityId: string;
  timestamp: string;
  context: string;
  source: string;
}

export interface EntityAlias {
  id: string;
  entityId: string;
  alias: string;
  createdAt: string;
}

export interface EntityTag {
  entityId: string;
  tag: string;
}

export interface GraphStats {
  totalEntities: number;
  totalRelationships: number;
  totalAliases: number;
  totalTags: number;
  avgConnections: number;
  mostConnected: Array<{ name: string; connections: number }>;
  entityTypeDistribution: Record<string, number>;
  relationshipTypeDistribution: Record<string, number>;
}

export interface SubgraphResult {
  entities: Entity[];
  relationships: Relationship[];
}

// ─── Row Types ──────────────────────────────────────────────────────────────

interface EntityRow {
  id: string;
  type: string;
  name: string;
  category: string | null;
  parent_id: string | null;
  attributes: string;
  embedding: Buffer | null;
  first_seen: string;
  last_seen: string;
  mention_count: number;
  confidence: number;
  importance: number;
}

interface RelationshipRow {
  id: string;
  source_id: string;
  target_id: string;
  type: string;
  weight: number;
  context: string;
  timestamp: string;
  start_date: string | null;
  end_date: string | null;
  bidirectional: number;
}

interface TimelineRow {
  id: string;
  entity_id: string;
  timestamp: string;
  context: string;
  source: string;
}

interface AliasRow {
  id: string;
  entity_id: string;
  alias: string;
  created_at: string;
}

interface CountRow {
  count: number;
}

interface AvgRow {
  avg: number | null;
}

interface ConnectedRow {
  name: string;
  connections: number;
}

interface TypeDistRow {
  type: string;
  count: number;
}

interface IdRow {
  id: string;
}

interface DepthRow {
  id: string;
  depth: number;
}

// ─── Knowledge Graph ────────────────────────────────────────────────────────

export class KnowledgeGraph {
  private db: Database.Database;

  constructor(dbPath: string) {
    try {
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('cache_size = -64000'); // 64MB cache
      this.createTables();
    } catch (error) {
      throw new MemoryError(`Failed to open knowledge graph database: ${error}`);
    }
  }

  // ─── Schema ─────────────────────────────────────────────────────────────

  private createTables(): void {
    this.db.exec(`
      -- Core entity table with category hierarchy & importance
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT,
        parent_id TEXT,
        attributes TEXT NOT NULL DEFAULT '{}',
        embedding BLOB,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        mention_count INTEGER NOT NULL DEFAULT 1,
        confidence REAL NOT NULL DEFAULT 0.5,
        importance REAL NOT NULL DEFAULT 0.0,
        FOREIGN KEY (parent_id) REFERENCES entities(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
      CREATE INDEX IF NOT EXISTS idx_entities_category ON entities(category);
      CREATE INDEX IF NOT EXISTS idx_entities_parent ON entities(parent_id);
      CREATE INDEX IF NOT EXISTS idx_entities_importance ON entities(importance DESC);
      CREATE INDEX IF NOT EXISTS idx_entities_last_seen ON entities(last_seen DESC);

      -- FTS5 full-text search on entities
      CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
        name,
        attributes,
        content=entities,
        content_rowid=rowid,
        tokenize='porter unicode61'
      );

      -- Triggers to keep FTS in sync
      CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
        INSERT INTO entities_fts(rowid, name, attributes) VALUES (new.rowid, new.name, new.attributes);
      END;
      CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
        INSERT INTO entities_fts(entities_fts, rowid, name, attributes) VALUES ('delete', old.rowid, old.name, old.attributes);
      END;
      CREATE TRIGGER IF NOT EXISTS entities_au AFTER UPDATE ON entities BEGIN
        INSERT INTO entities_fts(entities_fts, rowid, name, attributes) VALUES ('delete', old.rowid, old.name, old.attributes);
        INSERT INTO entities_fts(rowid, name, attributes) VALUES (new.rowid, new.name, new.attributes);
      END;

      -- Entity aliases (coreference resolution)
      CREATE TABLE IF NOT EXISTS entity_aliases (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        alias TEXT NOT NULL COLLATE NOCASE,
        created_at TEXT NOT NULL,
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_alias_unique ON entity_aliases(alias);
      CREATE INDEX IF NOT EXISTS idx_alias_entity ON entity_aliases(entity_id);

      -- Entity tags / labels
      CREATE TABLE IF NOT EXISTS entity_tags (
        entity_id TEXT NOT NULL,
        tag TEXT NOT NULL COLLATE NOCASE,
        PRIMARY KEY (entity_id, tag),
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tags_tag ON entity_tags(tag);

      -- Temporal timeline of entity mentions
      CREATE TABLE IF NOT EXISTS entity_timeline (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        context TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_timeline_entity ON entity_timeline(entity_id);
      CREATE INDEX IF NOT EXISTS idx_timeline_ts ON entity_timeline(timestamp DESC);

      -- Relationships with temporal bounds and bidirectionality
      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        context TEXT NOT NULL DEFAULT '',
        timestamp TEXT NOT NULL,
        start_date TEXT,
        end_date TEXT,
        bidirectional INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (source_id) REFERENCES entities(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES entities(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_id);
      CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_id);
      CREATE INDEX IF NOT EXISTS idx_rel_type ON relationships(type);
      CREATE INDEX IF NOT EXISTS idx_rel_weight ON relationships(weight DESC);
      CREATE INDEX IF NOT EXISTS idx_rel_timestamp ON relationships(timestamp DESC);
    `);
  }

  // ─── Entity CRUD ────────────────────────────────────────────────────────

  addEntity(entity: Omit<Entity, 'id'> & { id?: string; category?: string; parentId?: string }): Entity {
    const id = entity.id ?? nanoid();
    const now = new Date().toISOString();
    const embeddingBuffer = entity.embedding
      ? Buffer.from(entity.embedding.buffer, entity.embedding.byteOffset, entity.embedding.byteLength)
      : null;

    const firstSeen = entity.firstSeen ?? now;
    const lastSeen = entity.lastSeen ?? now;

    this.db.prepare(`
      INSERT INTO entities (id, type, name, category, parent_id, attributes, embedding, first_seen, last_seen, mention_count, confidence, importance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entity.type,
      entity.name,
      (entity as Record<string, unknown>).category as string | null ?? null,
      (entity as Record<string, unknown>).parentId as string | null ?? null,
      JSON.stringify(entity.attributes),
      embeddingBuffer,
      firstSeen,
      lastSeen,
      entity.mentionCount ?? 1,
      entity.confidence ?? 0.5,
      0.0
    );

    // Auto-add the canonical name as an alias
    this.addAlias(id, entity.name);

    // Recalculate importance
    this.recalculateImportance(id);

    return { ...entity, id, firstSeen, lastSeen } as Entity;
  }

  addEntities(entities: Array<Omit<Entity, 'id'> & { id?: string; category?: string; parentId?: string }>): Entity[] {
    const results: Entity[] = [];
    const transaction = this.db.transaction(() => {
      for (const entity of entities) {
        results.push(this.addEntity(entity));
      }
    });
    transaction();
    return results;
  }

  updateEntity(id: string, updates: Partial<Omit<Entity, 'id'>> & { category?: string; parentId?: string }): void {
    const existing = this.getEntity(id);
    if (!existing) {
      throw new MemoryError(`Entity not found: ${id}`);
    }

    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.type !== undefined) { fields.push('type = ?'); values.push(updates.type); }
    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.attributes !== undefined) { fields.push('attributes = ?'); values.push(JSON.stringify(updates.attributes)); }
    if (updates.embedding !== undefined) {
      fields.push('embedding = ?');
      values.push(updates.embedding ? Buffer.from(updates.embedding.buffer, updates.embedding.byteOffset, updates.embedding.byteLength) : null);
    }
    if (updates.firstSeen !== undefined) { fields.push('first_seen = ?'); values.push(updates.firstSeen); }
    if (updates.lastSeen !== undefined) { fields.push('last_seen = ?'); values.push(updates.lastSeen); }
    if (updates.mentionCount !== undefined) { fields.push('mention_count = ?'); values.push(updates.mentionCount); }
    if (updates.confidence !== undefined) { fields.push('confidence = ?'); values.push(updates.confidence); }
    if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category); }
    if (updates.parentId !== undefined) { fields.push('parent_id = ?'); values.push(updates.parentId); }

    if (fields.length === 0) return;

    values.push(id);
    this.db.prepare(`UPDATE entities SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    // Recalculate importance after update
    this.recalculateImportance(id);
  }

  getEntity(id: string): Entity | null {
    const row = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as EntityRow | undefined;
    return row ? this.rowToEntity(row) : null;
  }

  findEntities(query: string): Entity[] {
    if (!query || query.trim().length === 0) {
      return this.getAllEntities();
    }
    const rows = this.db.prepare(
      'SELECT * FROM entities WHERE name LIKE ? OR type LIKE ? ORDER BY importance DESC, mention_count DESC'
    ).all(`%${query}%`, `%${query}%`) as EntityRow[];
    return rows.map(r => this.rowToEntity(r));
  }

  findEntityByName(name: string): Entity | null {
    // First try exact match
    const row = this.db.prepare(
      'SELECT * FROM entities WHERE name = ? COLLATE NOCASE'
    ).get(name) as EntityRow | undefined;
    if (row) return this.rowToEntity(row);

    // Then try alias resolution
    const aliasRow = this.db.prepare(
      'SELECT entity_id FROM entity_aliases WHERE alias = ? COLLATE NOCASE'
    ).get(name) as { entity_id: string } | undefined;
    if (aliasRow) return this.getEntity(aliasRow.entity_id);

    return null;
  }

  resolveEntityName(name: string): Entity | null {
    return this.findEntityByName(name);
  }

  deleteEntity(id: string): void {
    this.db.prepare('DELETE FROM entities WHERE id = ?').run(id);
  }

  getAllEntities(): Entity[] {
    const rows = this.db.prepare('SELECT * FROM entities ORDER BY importance DESC, mention_count DESC').all() as EntityRow[];
    return rows.map(r => this.rowToEntity(r));
  }

  getEntitiesByType(type: string): Entity[] {
    const rows = this.db.prepare('SELECT * FROM entities WHERE type = ? ORDER BY importance DESC').all(type) as EntityRow[];
    return rows.map(r => this.rowToEntity(r));
  }

  getEntitiesByCategory(category: string): Entity[] {
    const rows = this.db.prepare('SELECT * FROM entities WHERE category = ? ORDER BY importance DESC').all(category) as EntityRow[];
    return rows.map(r => this.rowToEntity(r));
  }

  getChildren(parentId: string): Entity[] {
    const rows = this.db.prepare('SELECT * FROM entities WHERE parent_id = ? ORDER BY name').all(parentId) as EntityRow[];
    return rows.map(r => this.rowToEntity(r));
  }

  // ─── FTS5 Full-Text Search ──────────────────────────────────────────────

  searchFTS(query: string, limit: number = 20): Entity[] {
    if (!query || query.trim().length === 0) return [];

    try {
      // Use FTS5 match with ranking
      const rows = this.db.prepare(`
        SELECT e.* FROM entities e
        JOIN entities_fts fts ON e.rowid = fts.rowid
        WHERE entities_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(query, limit) as EntityRow[];
      return rows.map(r => this.rowToEntity(r));
    } catch {
      // Fall back to LIKE search if FTS query syntax is invalid
      return this.findEntities(query);
    }
  }

  // ─── Aliases ────────────────────────────────────────────────────────────

  addAlias(entityId: string, alias: string): void {
    const id = nanoid();
    const now = new Date().toISOString();
    try {
      this.db.prepare(`
        INSERT OR IGNORE INTO entity_aliases (id, entity_id, alias, created_at)
        VALUES (?, ?, ?, ?)
      `).run(id, entityId, alias, now);
    } catch {
      // Alias may already exist for another entity - skip silently
    }
  }

  addAliases(entityId: string, aliases: string[]): void {
    const transaction = this.db.transaction(() => {
      for (const alias of aliases) {
        this.addAlias(entityId, alias);
      }
    });
    transaction();
  }

  getAliases(entityId: string): string[] {
    const rows = this.db.prepare(
      'SELECT alias FROM entity_aliases WHERE entity_id = ?'
    ).all(entityId) as Array<{ alias: string }>;
    return rows.map(r => r.alias);
  }

  resolveAlias(alias: string): string | null {
    const row = this.db.prepare(
      'SELECT entity_id FROM entity_aliases WHERE alias = ? COLLATE NOCASE'
    ).get(alias) as { entity_id: string } | undefined;
    return row?.entity_id ?? null;
  }

  // ─── Tags ───────────────────────────────────────────────────────────────

  addTag(entityId: string, tag: string): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO entity_tags (entity_id, tag) VALUES (?, ?)
    `).run(entityId, tag.toLowerCase());
  }

  addTags(entityId: string, tags: string[]): void {
    const transaction = this.db.transaction(() => {
      for (const tag of tags) {
        this.addTag(entityId, tag);
      }
    });
    transaction();
  }

  getTags(entityId: string): string[] {
    const rows = this.db.prepare(
      'SELECT tag FROM entity_tags WHERE entity_id = ?'
    ).all(entityId) as Array<{ tag: string }>;
    return rows.map(r => r.tag);
  }

  getEntitiesByTag(tag: string): Entity[] {
    const rows = this.db.prepare(`
      SELECT e.* FROM entities e
      JOIN entity_tags t ON e.id = t.entity_id
      WHERE t.tag = ?
      ORDER BY e.importance DESC
    `).all(tag.toLowerCase()) as EntityRow[];
    return rows.map(r => this.rowToEntity(r));
  }

  removeTag(entityId: string, tag: string): void {
    this.db.prepare('DELETE FROM entity_tags WHERE entity_id = ? AND tag = ?').run(entityId, tag.toLowerCase());
  }

  // ─── Timeline ───────────────────────────────────────────────────────────

  addTimelineEntry(entityId: string, context: string, source: string, timestamp?: string): void {
    const id = nanoid();
    const ts = timestamp ?? new Date().toISOString();
    this.db.prepare(`
      INSERT INTO entity_timeline (id, entity_id, timestamp, context, source)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, entityId, ts, context, source);
  }

  getTimeline(entityId: string, limit: number = 50): EntityTimeline[] {
    const rows = this.db.prepare(`
      SELECT * FROM entity_timeline
      WHERE entity_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(entityId, limit) as TimelineRow[];
    return rows.map(r => ({
      entityId: r.entity_id,
      timestamp: r.timestamp,
      context: r.context,
      source: r.source,
    }));
  }

  getEntitiesMentionedBetween(start: string, end: string): Entity[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT e.* FROM entities e
      JOIN entity_timeline t ON e.id = t.entity_id
      WHERE t.timestamp BETWEEN ? AND ?
      ORDER BY e.importance DESC
    `).all(start, end) as EntityRow[];
    return rows.map(r => this.rowToEntity(r));
  }

  getRecentlyActive(hours: number = 24): Entity[] {
    const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
    const rows = this.db.prepare(`
      SELECT DISTINCT e.* FROM entities e
      JOIN entity_timeline t ON e.id = t.entity_id
      WHERE t.timestamp > ?
      ORDER BY e.importance DESC
    `).all(cutoff) as EntityRow[];
    return rows.map(r => this.rowToEntity(r));
  }

  // ─── Relationships ──────────────────────────────────────────────────────

  addRelationship(rel: Omit<Relationship, 'id'> & {
    id?: string;
    startDate?: string;
    endDate?: string;
    bidirectional?: boolean;
  }): Relationship {
    const id = rel.id ?? nanoid();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO relationships (id, source_id, target_id, type, weight, context, timestamp, start_date, end_date, bidirectional)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      rel.sourceId,
      rel.targetId,
      rel.type,
      rel.weight ?? 1.0,
      rel.context ?? '',
      rel.timestamp ?? now,
      rel.startDate ?? null,
      rel.endDate ?? null,
      rel.bidirectional ? 1 : 0
    );

    // Recalculate importance for connected entities
    this.recalculateImportance(rel.sourceId);
    this.recalculateImportance(rel.targetId);

    return { ...rel, id, timestamp: rel.timestamp ?? now, weight: rel.weight ?? 1.0, context: rel.context ?? '' };
  }

  addRelationships(relationships: Array<Omit<Relationship, 'id'> & {
    id?: string;
    startDate?: string;
    endDate?: string;
    bidirectional?: boolean;
  }>): Relationship[] {
    const results: Relationship[] = [];
    const transaction = this.db.transaction(() => {
      for (const rel of relationships) {
        results.push(this.addRelationship(rel));
      }
    });
    transaction();
    return results;
  }

  getRelationships(entityId: string): Relationship[] {
    const rows = this.db.prepare(`
      SELECT * FROM relationships
      WHERE source_id = ? OR target_id = ?
      ORDER BY weight DESC
    `).all(entityId, entityId) as RelationshipRow[];
    return rows.map(r => this.rowToRelationship(r));
  }

  getRelationshipsByType(entityId: string, type: string): Relationship[] {
    const rows = this.db.prepare(`
      SELECT * FROM relationships
      WHERE (source_id = ? OR target_id = ?) AND type = ?
      ORDER BY weight DESC
    `).all(entityId, entityId, type) as RelationshipRow[];
    return rows.map(r => this.rowToRelationship(r));
  }

  getRelationshipBetween(entityA: string, entityB: string): Relationship[] {
    const rows = this.db.prepare(`
      SELECT * FROM relationships
      WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)
      ORDER BY weight DESC
    `).all(entityA, entityB, entityB, entityA) as RelationshipRow[];
    return rows.map(r => this.rowToRelationship(r));
  }

  getRelationshipById(id: string): Relationship | null {
    const row = this.db.prepare('SELECT * FROM relationships WHERE id = ?').get(id) as RelationshipRow | undefined;
    return row ? this.rowToRelationship(row) : null;
  }

  updateRelationship(id: string, updates: Partial<Omit<Relationship, 'id'>> & {
    startDate?: string;
    endDate?: string;
    bidirectional?: boolean;
  }): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.weight !== undefined) { fields.push('weight = ?'); values.push(updates.weight); }
    if (updates.context !== undefined) { fields.push('context = ?'); values.push(updates.context); }
    if (updates.type !== undefined) { fields.push('type = ?'); values.push(updates.type); }
    if (updates.timestamp !== undefined) { fields.push('timestamp = ?'); values.push(updates.timestamp); }
    if (updates.startDate !== undefined) { fields.push('start_date = ?'); values.push(updates.startDate); }
    if (updates.endDate !== undefined) { fields.push('end_date = ?'); values.push(updates.endDate); }
    if (updates.bidirectional !== undefined) { fields.push('bidirectional = ?'); values.push(updates.bidirectional ? 1 : 0); }

    if (fields.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE relationships SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  deleteRelationship(id: string): void {
    this.db.prepare('DELETE FROM relationships WHERE id = ?').run(id);
  }

  // ─── Graph Traversal ───────────────────────────────────────────────────

  getConnectedEntities(entityId: string, depth: number = 1): Entity[] {
    const visited = new Set<string>([entityId]);
    let frontier = [entityId];

    for (let d = 0; d < depth; d++) {
      const nextFrontier: string[] = [];
      for (const nodeId of frontier) {
        const rels = this.getRelationships(nodeId);
        for (const rel of rels) {
          const neighbor = rel.sourceId === nodeId ? rel.targetId : rel.sourceId;
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            nextFrontier.push(neighbor);
          }
        }
      }
      frontier = nextFrontier;
      if (frontier.length === 0) break;
    }

    visited.delete(entityId);
    const entities: Entity[] = [];
    for (const id of visited) {
      const entity = this.getEntity(id);
      if (entity) entities.push(entity);
    }
    return entities;
  }

  /**
   * BFS shortest path between two entities.
   * Returns the entity IDs along the path (inclusive), or null if no path exists.
   */
  shortestPath(fromId: string, toId: string, maxDepth: number = 10): string[] | null {
    if (fromId === toId) return [fromId];

    const visited = new Set<string>([fromId]);
    const parentMap = new Map<string, string>(); // child -> parent
    let frontier = [fromId];

    for (let d = 0; d < maxDepth; d++) {
      const nextFrontier: string[] = [];
      for (const nodeId of frontier) {
        const rels = this.getRelationships(nodeId);
        for (const rel of rels) {
          const neighbor = rel.sourceId === nodeId ? rel.targetId : rel.sourceId;
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            parentMap.set(neighbor, nodeId);
            if (neighbor === toId) {
              // Reconstruct path
              const path: string[] = [toId];
              let current = toId;
              while (current !== fromId) {
                const parent = parentMap.get(current);
                if (!parent) return null;
                path.unshift(parent);
                current = parent;
              }
              return path;
            }
            nextFrontier.push(neighbor);
          }
        }
      }
      frontier = nextFrontier;
      if (frontier.length === 0) break;
    }

    return null;
  }

  /**
   * Extract a subgraph around an entity up to a given depth.
   */
  getSubgraph(entityId: string, depth: number = 2): SubgraphResult {
    const entityIds = new Set<string>([entityId]);
    let frontier = [entityId];

    for (let d = 0; d < depth; d++) {
      const nextFrontier: string[] = [];
      for (const nodeId of frontier) {
        const rels = this.getRelationships(nodeId);
        for (const rel of rels) {
          const neighbor = rel.sourceId === nodeId ? rel.targetId : rel.sourceId;
          if (!entityIds.has(neighbor)) {
            entityIds.add(neighbor);
            nextFrontier.push(neighbor);
          }
        }
      }
      frontier = nextFrontier;
      if (frontier.length === 0) break;
    }

    const entities: Entity[] = [];
    for (const id of entityIds) {
      const entity = this.getEntity(id);
      if (entity) entities.push(entity);
    }

    // Collect all relationships between subgraph entities
    const relationshipMap = new Map<string, Relationship>();
    for (const id of entityIds) {
      const rels = this.getRelationships(id);
      for (const rel of rels) {
        if (entityIds.has(rel.sourceId) && entityIds.has(rel.targetId)) {
          relationshipMap.set(rel.id, rel);
        }
      }
    }

    return {
      entities,
      relationships: Array.from(relationshipMap.values()),
    };
  }

  /**
   * Find the cluster of tightly connected entities around a seed entity.
   * Uses a simple greedy modularity-based approach.
   */
  getCluster(entityId: string, maxSize: number = 30): Entity[] {
    const cluster = new Set<string>([entityId]);
    const candidates = new Set<string>();

    // Seed candidates from direct neighbors
    const seedRels = this.getRelationships(entityId);
    for (const rel of seedRels) {
      const neighbor = rel.sourceId === entityId ? rel.targetId : rel.sourceId;
      candidates.add(neighbor);
    }

    while (cluster.size < maxSize && candidates.size > 0) {
      // Pick the candidate most connected to the current cluster
      let bestCandidate: string | null = null;
      let bestScore = 0;

      for (const candidate of candidates) {
        const rels = this.getRelationships(candidate);
        let internalWeight = 0;
        for (const rel of rels) {
          const neighbor = rel.sourceId === candidate ? rel.targetId : rel.sourceId;
          if (cluster.has(neighbor)) {
            internalWeight += rel.weight;
          }
        }
        if (internalWeight > bestScore) {
          bestScore = internalWeight;
          bestCandidate = candidate;
        }
      }

      if (!bestCandidate || bestScore < 0.5) break;

      cluster.add(bestCandidate);
      candidates.delete(bestCandidate);

      // Add new neighbors of the accepted node as candidates
      const newRels = this.getRelationships(bestCandidate);
      for (const rel of newRels) {
        const neighbor = rel.sourceId === bestCandidate ? rel.targetId : rel.sourceId;
        if (!cluster.has(neighbor)) {
          candidates.add(neighbor);
        }
      }
    }

    const entities: Entity[] = [];
    for (const id of cluster) {
      const entity = this.getEntity(id);
      if (entity) entities.push(entity);
    }
    return entities;
  }

  // ─── Importance Calculation ─────────────────────────────────────────────

  /**
   * Recalculate the importance score for an entity based on:
   * - Mention frequency (normalized)
   * - Recency of last mention (exponential decay)
   * - Connection density (number & weight of relationships)
   */
  recalculateImportance(entityId: string): void {
    const entity = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(entityId) as EntityRow | undefined;
    if (!entity) return;

    // Factor 1: Mention frequency (log scale, cap at ~20 mentions)
    const mentionScore = Math.min(Math.log2(entity.mention_count + 1) / Math.log2(21), 1.0);

    // Factor 2: Recency (exponential decay, half-life = 7 days)
    const ageMs = Date.now() - new Date(entity.last_seen).getTime();
    const halfLifeMs = 7 * 24 * 3600_000;
    const recencyScore = Math.exp(-ageMs * Math.LN2 / halfLifeMs);

    // Factor 3: Connection density
    const relCount = (this.db.prepare(
      'SELECT COUNT(*) as count FROM relationships WHERE source_id = ? OR target_id = ?'
    ).get(entityId, entityId) as CountRow).count;
    const connectionScore = Math.min(relCount / 20, 1.0);

    // Factor 4: Confidence
    const confidenceScore = entity.confidence;

    // Weighted combination
    const importance = (
      mentionScore * 0.3 +
      recencyScore * 0.25 +
      connectionScore * 0.25 +
      confidenceScore * 0.2
    );

    this.db.prepare('UPDATE entities SET importance = ? WHERE id = ?').run(importance, entityId);
  }

  recalculateAllImportance(): void {
    const rows = this.db.prepare('SELECT id FROM entities').all() as IdRow[];
    const transaction = this.db.transaction(() => {
      for (const row of rows) {
        this.recalculateImportance(row.id);
      }
    });
    transaction();
  }

  // ─── Search ─────────────────────────────────────────────────────────────

  search(query: string): { entities: Entity[]; relationships: Relationship[] } {
    const entities = this.findEntities(query);
    const relationshipSet = new Map<string, Relationship>();

    for (const entity of entities) {
      const rels = this.getRelationships(entity.id);
      for (const rel of rels) {
        relationshipSet.set(rel.id, rel);
      }
    }

    return { entities, relationships: Array.from(relationshipSet.values()) };
  }

  // ─── Statistics ─────────────────────────────────────────────────────────

  getStats(): GraphStats {
    const totalEntities = (this.db.prepare('SELECT COUNT(*) as count FROM entities').get() as CountRow).count;
    const totalRelationships = (this.db.prepare('SELECT COUNT(*) as count FROM relationships').get() as CountRow).count;
    const totalAliases = (this.db.prepare('SELECT COUNT(*) as count FROM entity_aliases').get() as CountRow).count;
    const totalTags = (this.db.prepare('SELECT COUNT(DISTINCT tag) as count FROM entity_tags').get() as CountRow).count;

    const avgRow = this.db.prepare(`
      SELECT AVG(conn_count) as avg FROM (
        SELECT COUNT(*) as conn_count FROM relationships GROUP BY source_id
        UNION ALL
        SELECT COUNT(*) as conn_count FROM relationships GROUP BY target_id
      )
    `).get() as AvgRow;
    const avgConnections = avgRow.avg ?? 0;

    const mostConnected = this.db.prepare(`
      SELECT e.name, COUNT(*) as connections
      FROM entities e
      LEFT JOIN relationships r ON e.id = r.source_id OR e.id = r.target_id
      GROUP BY e.id
      ORDER BY connections DESC
      LIMIT 10
    `).all() as ConnectedRow[];

    const entityTypeDist = this.db.prepare(
      'SELECT type, COUNT(*) as count FROM entities GROUP BY type'
    ).all() as TypeDistRow[];
    const entityTypeDistribution: Record<string, number> = {};
    for (const row of entityTypeDist) {
      entityTypeDistribution[row.type] = row.count;
    }

    const relTypeDist = this.db.prepare(
      'SELECT type, COUNT(*) as count FROM relationships GROUP BY type'
    ).all() as TypeDistRow[];
    const relationshipTypeDistribution: Record<string, number> = {};
    for (const row of relTypeDist) {
      relationshipTypeDistribution[row.type] = row.count;
    }

    return {
      totalEntities,
      totalRelationships,
      totalAliases,
      totalTags,
      avgConnections,
      mostConnected: mostConnected.map(r => ({ name: r.name, connections: r.connections })),
      entityTypeDistribution,
      relationshipTypeDistribution,
    };
  }

  // ─── Utility ────────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }

  /**
   * Run a function inside a transaction for batch operations.
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  private rowToEntity(row: EntityRow): Entity {
    const entity: Entity = {
      id: row.id,
      type: row.type as Entity['type'],
      name: row.name,
      attributes: JSON.parse(row.attributes) as Record<string, unknown>,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      mentionCount: row.mention_count,
      confidence: row.confidence,
    };
    if (row.embedding) {
      entity.embedding = new Float32Array(
        (row.embedding as Buffer).buffer,
        (row.embedding as Buffer).byteOffset,
        (row.embedding as Buffer).byteLength / 4
      );
    }
    // Attach extended fields via attributes
    if (row.category) {
      entity.attributes['category'] = row.category;
    }
    if (row.parent_id) {
      entity.attributes['parentId'] = row.parent_id;
    }
    if (row.importance !== undefined) {
      entity.attributes['importance'] = row.importance;
    }
    return entity;
  }

  private rowToRelationship(row: RelationshipRow): Relationship {
    const rel: Relationship = {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      type: row.type,
      weight: row.weight,
      context: row.context,
      timestamp: row.timestamp,
    };
    if (row.start_date) {
      (rel as unknown as Record<string, unknown>)['startDate'] = row.start_date;
    }
    if (row.end_date) {
      (rel as unknown as Record<string, unknown>)['endDate'] = row.end_date;
    }
    if (row.bidirectional) {
      (rel as unknown as Record<string, unknown>)['bidirectional'] = row.bidirectional === 1;
    }
    return rel;
  }
}
