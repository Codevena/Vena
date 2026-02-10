import type { Message, Entity, Relationship } from '@vena/shared';
import { MemoryError } from '@vena/shared';
import { KnowledgeGraph } from './knowledge-graph.js';
import { EntityExtractor, type ExtractFn, type ExtractionOptions } from './entity-extractor.js';
import { RelationshipMapper } from './relationship-mapper.js';
import { SemanticIndex, type EmbedFn, type SearchResult } from './semantic-index.js';
import { ContextRanker, type MemoryFragment, type RankedFragment } from './context-ranker.js';
import { MemoryConsolidator, type SummarizeFn, type PromotionCandidate } from './memory-consolidator.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MemoryEngineConfig {
  dbPath: string;
  indexDbPath?: string;
  extractFn: ExtractFn;
  summarizeFn: SummarizeFn;
  embedFn?: EmbedFn;
  extractionOptions?: ExtractionOptions;
}

export interface RecallOptions {
  maxTokens?: number;
  limit?: number;
  sources?: string[];
  includeGraph?: boolean;
  timeRange?: { start?: string; end?: string };
}

export interface EntityProfile {
  entity: Entity;
  relationships: Array<{
    relationship: Relationship;
    relatedEntity: Entity;
    direction: 'outgoing' | 'incoming';
  }>;
  mentions: SearchResult[];
  clusters: string[];
  inferredConnections: Array<{
    entity: Entity;
    reason: string;
    confidence: number;
  }>;
}

export interface MemoryStats {
  totalEntities: number;
  totalRelationships: number;
  totalIndexEntries: number;
  totalSources: number;
  entityTypes: Record<string, number>;
  topEntities: Array<{ name: string; type: string; mentions: number }>;
  oldestMemory: string | null;
  newestMemory: string | null;
}

export interface TimelineEntry {
  timestamp: string;
  content: string;
  source: string;
  entities: string[];
}

// ─── Memory Engine ──────────────────────────────────────────────────────────

/**
 * The Memory Engine is the high-level orchestrator for Vena's semantic memory.
 * It ties together the Knowledge Graph, Entity Extraction, Semantic Index,
 * Context Ranking, and Memory Consolidation into a unified API.
 */
export class MemoryEngine {
  private graph: KnowledgeGraph;
  private extractor: EntityExtractor;
  private mapper: RelationshipMapper;
  private index: SemanticIndex;
  private ranker: ContextRanker;
  private consolidator: MemoryConsolidator;
  private extractionOptions: ExtractionOptions;

  constructor(config: MemoryEngineConfig) {
    this.graph = new KnowledgeGraph(config.dbPath);
    this.extractor = new EntityExtractor(config.extractFn);
    this.mapper = new RelationshipMapper(this.graph);
    this.index = new SemanticIndex(this.graph, config.indexDbPath, config.embedFn);
    this.ranker = new ContextRanker(this.graph);
    this.consolidator = new MemoryConsolidator(config.summarizeFn, this.graph);
    this.extractionOptions = config.extractionOptions ?? {};
  }

  // ─── Core Operations ────────────────────────────────────────────────────────

  /**
   * Ingest new messages: extract entities, update graph, index content.
   * This is the main entry point after each conversation turn.
   */
  async ingest(messages: Message[], agentId: string): Promise<{
    entities: Partial<Entity>[];
    relationships: Partial<Relationship>[];
    indexed: number;
  }> {
    const textMessages = messages
      .filter(m => typeof m.content === 'string' && m.content.length > 0)
      .map(m => m.content as string);

    if (textMessages.length === 0) {
      return { entities: [], relationships: [], indexed: 0 };
    }

    // Extract entities and relationships
    const existingEntities = this.graph.getAllEntities();
    const extraction = await this.extractor.extractBatch(
      textMessages,
      existingEntities,
      this.extractionOptions
    );

    // Store entities in knowledge graph
    for (const entity of extraction.entities) {
      if (!entity.name || !entity.type) continue;

      const existing = this.graph.findEntities(entity.name);
      const match = existing.find(e => e.name.toLowerCase() === entity.name!.toLowerCase());

      if (match) {
        // Update existing entity
        this.graph.updateEntity(match.id, {
          lastSeen: new Date().toISOString(),
          mentionCount: match.mentionCount + 1,
          confidence: Math.max(match.confidence, entity.confidence ?? 0.5),
          attributes: { ...match.attributes, ...entity.attributes },
        });
      } else {
        // Add new entity
        this.graph.addEntity({
          type: entity.type,
          name: entity.name,
          attributes: entity.attributes ?? {},
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          mentionCount: 1,
          confidence: entity.confidence ?? 0.5,
        });
      }
    }

    // Store relationships
    for (const rel of extraction.relationships) {
      if (!rel.sourceId || !rel.targetId || !rel.type) continue;

      // Resolve names to IDs
      const sourceEntities = this.graph.findEntities(rel.sourceId);
      const targetEntities = this.graph.findEntities(rel.targetId);

      if (sourceEntities.length > 0 && targetEntities.length > 0) {
        const sourceId = sourceEntities[0]!.id;
        const targetId = targetEntities[0]!.id;

        // Check if relationship already exists
        const existing = this.graph.getRelationshipBetween(sourceId, targetId);
        const existingOfType = existing.find(r => r.type === rel.type);

        if (existingOfType) {
          this.mapper.strengthenRelationship(existingOfType.id, 0.2);
        } else {
          this.graph.addRelationship({
            sourceId,
            targetId,
            type: rel.type,
            weight: rel.weight ?? 1.0,
            context: rel.context ?? '',
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    // Index the messages
    const combinedText = textMessages.join('\n\n');
    const indexIds = this.index.index(combinedText, `agent:${agentId}`, {
      agentId,
      messageCount: messages.length,
      timestamp: new Date().toISOString(),
    });

    return {
      entities: extraction.entities,
      relationships: extraction.relationships,
      indexed: indexIds.length,
    };
  }

  /**
   * Recall relevant memories for a query. Returns ranked and formatted context.
   */
  async recall(query: string, options: RecallOptions = {}): Promise<{
    context: string;
    fragments: RankedFragment[];
    relatedEntities: Entity[];
  }> {
    const { maxTokens = 4000, limit = 20, sources, includeGraph = true, timeRange } = options;

    // Search the semantic index (uses real embeddings when available)
    const searchResults = await this.index.searchAsync(query, {
      limit,
      sources,
      timeRange,
      expandQuery: true,
    });

    // Convert to memory fragments for ranking
    const fragments: MemoryFragment[] = searchResults.map(r => ({
      content: r.content,
      source: r.source,
      timestamp: r.timestamp,
      score: r.score,
      tokens: Math.ceil(r.content.length / 4),
    }));

    // Rank with MMR for diversity
    const ranked = this.ranker.rank(fragments, query, maxTokens);

    // Get related entities from the knowledge graph
    let relatedEntities: Entity[] = [];
    if (includeGraph) {
      const queryEntities = this.graph.findEntities(query);
      const relatedSet = new Map<string, Entity>();
      for (const entity of queryEntities) {
        relatedSet.set(entity.id, entity);
        const connected = this.graph.getConnectedEntities(entity.id, 1);
        for (const c of connected) {
          relatedSet.set(c.id, c);
        }
      }
      relatedEntities = Array.from(relatedSet.values());
    }

    // Build context string
    const contextParts: string[] = [];

    if (relatedEntities.length > 0) {
      const entitySummary = relatedEntities
        .slice(0, 10)
        .map(e => `- ${e.name} (${e.type}): mentioned ${e.mentionCount}x`)
        .join('\n');
      contextParts.push(`[Known Entities]\n${entitySummary}`);
    }

    if (ranked.length > 0) {
      const memorySummary = ranked
        .map(f => f.content)
        .join('\n---\n');
      contextParts.push(`[Relevant Memories]\n${memorySummary}`);
    }

    return {
      context: contextParts.join('\n\n'),
      fragments: ranked,
      relatedEntities,
    };
  }

  /**
   * Explicitly remember a fact.
   */
  remember(fact: string, source: string = 'explicit'): string[] {
    return this.index.index(fact, source, { explicit: true });
  }

  /**
   * Forget an entity or fact.
   */
  forget(entityOrFact: string): { deletedEntities: number; deletedIndex: number } {
    // Remove matching entities
    const entities = this.graph.findEntities(entityOrFact);
    for (const entity of entities) {
      this.graph.deleteEntity(entity.id);
    }

    // Remove from index
    const deletedIndex = this.index.removeBySource(entityOrFact);

    return { deletedEntities: entities.length, deletedIndex };
  }

  // ─── Entity Operations ──────────────────────────────────────────────────────

  /**
   * Get a comprehensive profile of an entity.
   */
  getEntityProfile(name: string): EntityProfile | null {
    const entities = this.graph.findEntities(name);
    if (entities.length === 0) return null;

    const entity = entities[0]!;
    const relationships = this.graph.getRelationships(entity.id);

    const relDetails = relationships.map(rel => {
      const isSource = rel.sourceId === entity.id;
      const relatedId = isSource ? rel.targetId : rel.sourceId;
      const relatedEntity = this.graph.getEntity(relatedId);

      return {
        relationship: rel,
        relatedEntity: relatedEntity!,
        direction: (isSource ? 'outgoing' : 'incoming') as 'outgoing' | 'incoming',
      };
    }).filter(r => r.relatedEntity !== null);

    // Find mentions in the index
    const mentions = this.index.search(entity.name, { limit: 10 });

    // Find clusters
    const clusters = this.mapper.detectClusters();
    const entityClusters = clusters
      .filter(c => c.entities.includes(entity.id))
      .map(c => c.clusterId);

    // Infer connections
    const inferred = this.mapper.inferRelationships(entity.id, 5);
    const inferredConnections = inferred.map(inf => {
      const targetEntity = this.graph.getEntity(inf.targetId);
      return {
        entity: targetEntity!,
        reason: inf.reason,
        confidence: inf.confidence,
      };
    }).filter(ic => ic.entity !== null);

    return {
      entity,
      relationships: relDetails,
      mentions,
      clusters: entityClusters,
      inferredConnections,
    };
  }

  /**
   * Get a chronological timeline of entity mentions.
   */
  getTimeline(entityName: string, limit: number = 20): TimelineEntry[] {
    const results = this.index.search(entityName, { limit });
    const entities = this.graph.findEntities(entityName);
    const entityNames = entities.map(e => e.name);

    return results.map(r => ({
      timestamp: r.timestamp,
      content: r.content,
      source: r.source,
      entities: entityNames.filter(name =>
        r.content.toLowerCase().includes(name.toLowerCase())
      ),
    })).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * Describe the relationship between two entities.
   */
  summarizeRelationship(entity1: string, entity2: string): string {
    const entities1 = this.graph.findEntities(entity1);
    const entities2 = this.graph.findEntities(entity2);

    if (entities1.length === 0 || entities2.length === 0) {
      return `No information found about the relationship between "${entity1}" and "${entity2}".`;
    }

    return this.mapper.describeRelationship(entities1[0]!.id, entities2[0]!.id);
  }

  // ─── Maintenance ──────────────────────────────────────────────────────────

  /**
   * Run the consolidation pipeline.
   */
  async consolidate(): Promise<{
    merged: number;
    removed: number;
    promoted: PromotionCandidate[];
    decayed: number;
  }> {
    // Get all indexed content as fragments
    const allResults = this.index.search('', { limit: 1000, threshold: 0 });
    const fragments: MemoryFragment[] = allResults.map(r => ({
      content: r.content,
      source: r.source,
      timestamp: r.timestamp,
      score: r.score,
      tokens: Math.ceil(r.content.length / 4),
    }));

    // Consolidate
    const result = await this.consolidator.consolidate(fragments);

    // Detect and resolve contradictions
    const contradictions = this.consolidator.detectContradictions(fragments);
    if (contradictions.length > 0) {
      this.consolidator.resolveContradictions(contradictions);
    }

    // Find promotion candidates
    const promoted = this.consolidator.promoteFrequent(fragments);

    // Decay old relationships
    const decayResult = this.mapper.decayRelationships();

    return {
      merged: result.merged.length,
      removed: result.removed.length,
      promoted,
      decayed: decayResult.decayed + decayResult.removed,
    };
  }

  /**
   * Get comprehensive memory statistics.
   */
  getMemoryStats(): MemoryStats {
    const entities = this.graph.getAllEntities();
    const graphStats = this.graph.getStats();
    const indexStats = this.index.getStats();

    // Count entity types
    const entityTypes: Record<string, number> = {};
    for (const entity of entities) {
      entityTypes[entity.type] = (entityTypes[entity.type] ?? 0) + 1;
    }

    // Top entities by mentions
    const topEntities = entities
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, 10)
      .map(e => ({ name: e.name, type: e.type, mentions: e.mentionCount }));

    return {
      totalEntities: graphStats.totalEntities,
      totalRelationships: graphStats.totalRelationships,
      totalIndexEntries: indexStats.totalEntries,
      totalSources: indexStats.totalSources,
      entityTypes,
      topEntities,
      oldestMemory: indexStats.oldestEntry,
      newestMemory: indexStats.newestEntry,
    };
  }

  /**
   * Export entire memory as structured data.
   */
  export(): {
    entities: Entity[];
    relationships: Relationship[];
    stats: MemoryStats;
  } {
    const entities = this.graph.getAllEntities();
    const relationships: Relationship[] = [];
    const seen = new Set<string>();

    for (const entity of entities) {
      const rels = this.graph.getRelationships(entity.id);
      for (const rel of rels) {
        if (!seen.has(rel.id)) {
          seen.add(rel.id);
          relationships.push(rel);
        }
      }
    }

    return {
      entities,
      relationships,
      stats: this.getMemoryStats(),
    };
  }

  /**
   * Close all database connections.
   */
  close(): void {
    this.graph.close();
    this.index.close();
  }
}
