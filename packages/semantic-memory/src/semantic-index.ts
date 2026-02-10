import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type { KnowledgeGraph } from './knowledge-graph.js';
import { MemoryError } from '@vena/shared';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IndexEntry {
  id: string;
  content: string;
  source: string;
  metadata: Record<string, unknown>;
  embedding: Float32Array | null;
  chunkIndex: number;
  totalChunks: number;
  timestamp: string;
}

/** Function that takes text and returns an embedding vector */
export type EmbedFn = (text: string) => Promise<Float32Array>;

export interface SearchOptions {
  limit?: number;
  threshold?: number;
  sources?: string[];
  timeRange?: { start?: string; end?: string };
  entityBoost?: string[];
  expandQuery?: boolean;
}

export interface SearchResult {
  id: string;
  content: string;
  source: string;
  score: number;
  timestamp: string;
  signals: {
    vector: number;
    bm25: number;
    graph: number;
    recency: number;
    entityDensity: number;
  };
}

interface IndexRow {
  id: string;
  content: string;
  source: string;
  metadata: string;
  embedding: Buffer | null;
  chunk_index: number;
  total_chunks: number;
  timestamp: string;
}

// ─── Semantic Index ─────────────────────────────────────────────────────────

export class SemanticIndex {
  private graph: KnowledgeGraph;
  private db: Database.Database;
  private avgDocLength: number = 0;
  private totalDocs: number = 0;
  private embedFn?: EmbedFn;

  constructor(graph: KnowledgeGraph, dbPath?: string, embedFn?: EmbedFn) {
    this.graph = graph;
    this.db = dbPath ? new Database(dbPath) : new Database(':memory:');
    this.embedFn = embedFn;
    this.db.pragma('journal_mode = WAL');
    this.createTables();
    this.refreshStats();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS index_entries (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        embedding BLOB,
        chunk_index INTEGER NOT NULL DEFAULT 0,
        total_chunks INTEGER NOT NULL DEFAULT 1,
        timestamp TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_index_source ON index_entries(source);
      CREATE INDEX IF NOT EXISTS idx_index_timestamp ON index_entries(timestamp);

      CREATE VIRTUAL TABLE IF NOT EXISTS index_fts USING fts5(
        content,
        source,
        content_rowid='rowid'
      );

      CREATE TABLE IF NOT EXISTS term_stats (
        term TEXT PRIMARY KEY,
        doc_count INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  // ─── Indexing ───────────────────────────────────────────────────────────────

  /**
   * Index content with smart chunking. Long content is split into overlapping chunks.
   */
  index(content: string, source: string, metadata: Record<string, unknown> = {}): string[] {
    const chunks = this.smartChunk(content, 400, 80);
    const ids: string[] = [];

    const insertEntry = this.db.prepare(`
      INSERT INTO index_entries (id, content, source, metadata, chunk_index, total_chunks, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = this.db.prepare(`INSERT INTO index_fts (rowid, content, source) VALUES (?, ?, ?)`);
    const upsertTerm = this.db.prepare(`
      INSERT INTO term_stats (term, doc_count) VALUES (?, 1)
      ON CONFLICT(term) DO UPDATE SET doc_count = doc_count + 1
    `);

    const transaction = this.db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const id = nanoid();
        const now = new Date().toISOString();

        insertEntry.run(id, chunks[i], source, JSON.stringify(metadata), i, chunks.length, now);

        // Get rowid for FTS
        const rowid = this.db.prepare('SELECT rowid FROM index_entries WHERE id = ?').get(id) as { rowid: number } | undefined;
        if (rowid) {
          insertFts.run(rowid.rowid, chunks[i], source);
        }

        // Update term stats
        const uniqueTerms = new Set(this.tokenize(chunks[i]!));
        for (const term of uniqueTerms) {
          upsertTerm.run(term);
        }

        ids.push(id);
      }
    });

    transaction();
    this.totalDocs += chunks.length;
    this.refreshStats();

    // Auto-embed chunks when an embedding function is available
    if (this.embedFn) {
      const update = this.db.prepare('UPDATE index_entries SET embedding = ? WHERE id = ?');
      for (let i = 0; i < ids.length; i++) {
        this.embedFn(chunks[i]!).then(embedding => {
          const buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
          update.run(buf, ids[i]);
        }).catch(() => {}); // Non-critical: embedding failures don't block indexing
      }
    }

    return ids;
  }

  /**
   * Index content with a pre-computed embedding vector.
   */
  indexWithEmbedding(content: string, source: string, embedding: Float32Array, metadata: Record<string, unknown> = {}): string[] {
    const ids = this.index(content, source, metadata);
    const embeddingBuf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);

    const update = this.db.prepare('UPDATE index_entries SET embedding = ? WHERE id = ?');
    for (const id of ids) {
      update.run(embeddingBuf, id);
    }
    return ids;
  }

  // ─── Search ─────────────────────────────────────────────────────────────────

  /**
   * Multi-signal hybrid search combining 5 signals:
   * - Vector similarity (40%) - cosine distance on embeddings
   * - BM25 keyword (20%) - proper BM25 with document length normalization
   * - Graph proximity (15%) - entity graph distance
   * - Recency boost (15%) - exponential decay favoring recent
   * - Entity density (10%) - content mentioning query-related entities
   */
  search(query: string, options: SearchOptions = {}, queryEmbedding?: Float32Array): SearchResult[] {
    const { limit = 10, threshold = 0.01, sources, timeRange, entityBoost, expandQuery = true } = options;

    // Expand query with entity aliases and related terms
    let expandedTerms = this.tokenize(query);
    if (expandQuery) {
      const expanded = this.expandQueryTerms(query);
      expandedTerms = [...new Set([...expandedTerms, ...expanded])];
    }

    // Find query-related entities for graph scoring
    const queryEntities = this.graph.findEntities(query);
    const boostEntities = entityBoost
      ? entityBoost.map(name => this.graph.findEntities(name)).flat()
      : [];
    const allQueryEntities = [...queryEntities, ...boostEntities];

    const connectedEntityNames = new Set<string>();
    for (const entity of allQueryEntities) {
      connectedEntityNames.add(entity.name.toLowerCase());
      const connected = this.graph.getConnectedEntities(entity.id, 2);
      for (const c of connected) {
        connectedEntityNames.add(c.name.toLowerCase());
      }
    }

    // Get all entries (or filtered by source/time)
    let entries: IndexRow[];
    if (sources || timeRange) {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (sources && sources.length > 0) {
        conditions.push(`source IN (${sources.map(() => '?').join(', ')})`);
        params.push(...sources);
      }
      if (timeRange?.start) {
        conditions.push('timestamp >= ?');
        params.push(timeRange.start);
      }
      if (timeRange?.end) {
        conditions.push('timestamp <= ?');
        params.push(timeRange.end);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      entries = this.db.prepare(`SELECT * FROM index_entries ${where}`).all(...params) as IndexRow[];
    } else {
      entries = this.db.prepare('SELECT * FROM index_entries').all() as IndexRow[];
    }

    // BM25 scores via FTS5 (if available)
    const ftsScores = new Map<string, number>();
    try {
      const ftsResults = this.db.prepare(`
        SELECT e.id, rank as score FROM index_fts f
        JOIN index_entries e ON e.rowid = f.rowid
        WHERE index_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(expandedTerms.join(' OR '), limit * 3) as Array<{ id: string; score: number }>;

      // FTS5 rank is negative (lower = better), normalize to 0-1
      const maxScore = ftsResults.length > 0 ? Math.abs(ftsResults[ftsResults.length - 1]!.score) : 1;
      for (const r of ftsResults) {
        ftsScores.set(r.id, 1 - (Math.abs(r.score) / (maxScore + 1)));
      }
    } catch {
      // FTS query failed, fall back to manual BM25
    }

    // Score each entry
    const results: SearchResult[] = [];

    for (const entry of entries) {
      const entryTokens = this.tokenize(entry.content);

      // Signal 1: Vector similarity (40%)
      let vectorScore = 0;
      if (queryEmbedding && entry.embedding) {
        // Real cosine similarity between query and document embeddings
        const entryEmbedding = new Float32Array(
          entry.embedding.buffer,
          entry.embedding.byteOffset,
          entry.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT,
        );
        vectorScore = cosineDistance(queryEmbedding, entryEmbedding);
      } else {
        // Fallback: token overlap as proxy for vector similarity
        const querySet = new Set(expandedTerms);
        const entrySet = new Set(entryTokens);
        const intersection = [...querySet].filter(t => entrySet.has(t));
        vectorScore = querySet.size > 0 ? intersection.length / Math.sqrt(querySet.size * entrySet.size) : 0;
      }

      // Signal 2: BM25 keyword (20%)
      const bm25Score = ftsScores.get(entry.id) ?? this.computeBM25(expandedTerms, entryTokens);

      // Signal 3: Graph proximity (15%)
      const graphScore = this.computeGraphProximity(entry.content, connectedEntityNames);

      // Signal 4: Recency boost (15%)
      const recencyScore = this.computeRecency(entry.timestamp);

      // Signal 5: Entity density (10%)
      const entityDensity = this.computeEntityDensity(entry.content, allQueryEntities.map(e => e.name));

      // Weighted combination
      const score = vectorScore * 0.40 + bm25Score * 0.20 + graphScore * 0.15 + recencyScore * 0.15 + entityDensity * 0.10;

      if (score >= threshold) {
        results.push({
          id: entry.id,
          content: entry.content,
          source: entry.source,
          score,
          timestamp: entry.timestamp,
          signals: {
            vector: vectorScore,
            bm25: bm25Score,
            graph: graphScore,
            recency: recencyScore,
            entityDensity,
          },
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Async search that auto-embeds the query when an embedding function is available.
   * Falls back to token-overlap vector scoring when no embedFn is set.
   */
  async searchAsync(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    let queryEmbedding: Float32Array | undefined;
    if (this.embedFn) {
      try {
        queryEmbedding = await this.embedFn(query);
      } catch {
        // Fall back to token-overlap scoring
      }
    }
    return this.search(query, options, queryEmbedding);
  }

  // ─── Smart Chunking ───────────────────────────────────────────────────────

  /**
   * Split text into chunks respecting sentence boundaries.
   * Uses ~400 token chunks with ~80 token overlap.
   */
  private smartChunk(text: string, targetTokens: number, overlapTokens: number): string[] {
    const estimatedChars = targetTokens * 4;
    const overlapChars = overlapTokens * 4;

    if (text.length <= estimatedChars) return [text];

    const sentences = text.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) ?? [text];
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > estimatedChars && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        // Overlap: keep the end of the current chunk
        const overlapStart = Math.max(0, currentChunk.length - overlapChars);
        currentChunk = currentChunk.slice(overlapStart) + sentence;
      } else {
        currentChunk += sentence;
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks.length > 0 ? chunks : [text];
  }

  // ─── Query Expansion ────────────────────────────────────────────────────────

  /**
   * Expand search query with entity aliases and related terms from the knowledge graph.
   */
  private expandQueryTerms(query: string): string[] {
    const expanded: string[] = [];
    const queryEntities = this.graph.findEntities(query);

    for (const entity of queryEntities) {
      // Add entity name tokens
      expanded.push(...this.tokenize(entity.name));

      // Add connected entity names
      const connected = this.graph.getConnectedEntities(entity.id, 1);
      for (const c of connected) {
        expanded.push(...this.tokenize(c.name));
      }
    }

    return expanded;
  }

  // ─── Scoring Functions ──────────────────────────────────────────────────────

  private computeBM25(queryTerms: string[], docTokens: string[]): number {
    const k1 = 1.2;
    const b = 0.75;
    const docLength = docTokens.length;
    const avgDl = this.avgDocLength || 100;

    const termFreqs = new Map<string, number>();
    for (const token of docTokens) {
      termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1);
    }

    let score = 0;
    for (const term of queryTerms) {
      const tf = termFreqs.get(term) ?? 0;
      if (tf === 0) continue;

      const dfRow = this.db.prepare('SELECT doc_count FROM term_stats WHERE term = ?').get(term) as { doc_count: number } | undefined;
      const df = dfRow?.doc_count ?? 0;
      const idf = Math.log((this.totalDocs - df + 0.5) / (df + 0.5) + 1);
      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLength / avgDl)));

      score += idf * tfNorm;
    }

    return Math.min(score / 10, 1.0);
  }

  private computeGraphProximity(content: string, connectedEntityNames: Set<string>): number {
    if (connectedEntityNames.size === 0) return 0;

    const contentLower = content.toLowerCase();
    let matchCount = 0;
    let totalChecked = 0;

    for (const name of connectedEntityNames) {
      totalChecked++;
      if (contentLower.includes(name)) {
        matchCount++;
      }
    }

    return totalChecked > 0 ? Math.min(matchCount / Math.sqrt(totalChecked), 1.0) : 0;
  }

  private computeRecency(timestamp: string): number {
    const ageMs = Date.now() - new Date(timestamp).getTime();
    const halfLifeMs = 7 * 24 * 3600_000; // 7-day half-life
    return Math.exp(-ageMs * Math.LN2 / halfLifeMs);
  }

  private computeEntityDensity(content: string, entityNames: string[]): number {
    if (entityNames.length === 0) return 0;

    const contentLower = content.toLowerCase();
    let matches = 0;
    for (const name of entityNames) {
      if (contentLower.includes(name.toLowerCase())) {
        matches++;
      }
    }
    return Math.min(matches / entityNames.length, 1.0);
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1);
  }

  private refreshStats(): void {
    const row = this.db.prepare('SELECT COUNT(*) as count, AVG(LENGTH(content)) as avg_len FROM index_entries').get() as { count: number; avg_len: number | null } | undefined;
    this.totalDocs = row?.count ?? 0;
    this.avgDocLength = row?.avg_len ? Math.ceil(row.avg_len / 4) : 100;
  }

  // ─── Maintenance ──────────────────────────────────────────────────────────

  removeBySource(source: string): number {
    const count = this.db.prepare('SELECT COUNT(*) as n FROM index_entries WHERE source = ?').get(source) as { n: number };
    this.db.prepare('DELETE FROM index_entries WHERE source = ?').run(source);
    this.refreshStats();
    return count.n;
  }

  getStats(): { totalEntries: number; totalSources: number; avgChunkSize: number; oldestEntry: string | null; newestEntry: string | null } {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT source) as sources,
        AVG(LENGTH(content)) as avg_size,
        MIN(timestamp) as oldest,
        MAX(timestamp) as newest
      FROM index_entries
    `).get() as { total: number; sources: number; avg_size: number | null; oldest: string | null; newest: string | null };

    return {
      totalEntries: stats.total,
      totalSources: stats.sources,
      avgChunkSize: Math.ceil(stats.avg_size ?? 0),
      oldestEntry: stats.oldest,
      newestEntry: stats.newest,
    };
  }

  close(): void {
    this.db.close();
  }
}

/** Compute cosine similarity between two Float32Array vectors */
export function cosineDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}
