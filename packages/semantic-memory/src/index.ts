// ─── Knowledge Graph ─────────────────────────────────────────────────────────
export { KnowledgeGraph } from './knowledge-graph.js';
export type { EntityTimeline, EntityAlias, EntityTag, GraphStats, SubgraphResult } from './knowledge-graph.js';

// ─── Entity Extraction ───────────────────────────────────────────────────────
export { EntityExtractor } from './entity-extractor.js';
export type {
  ExtractFn,
  ExtractionResult,
  ExtractionOptions,
  SentimentExtraction,
  TemporalExtraction,
  CoreferenceResolution,
} from './entity-extractor.js';

// ─── Relationship Mapping ────────────────────────────────────────────────────
export { RelationshipMapper } from './relationship-mapper.js';
export type {
  RelationshipTypeMeta,
  ClusterResult,
  InferredRelationship,
  RelationshipPath,
} from './relationship-mapper.js';

// ─── Semantic Index ──────────────────────────────────────────────────────────
export { SemanticIndex, cosineDistance } from './semantic-index.js';
export type { IndexEntry, SearchOptions, SearchResult } from './semantic-index.js';

// ─── Context Ranking ─────────────────────────────────────────────────────────
export { ContextRanker } from './context-ranker.js';
export type { MemoryFragment, RankOptions, RankedFragment } from './context-ranker.js';

// ─── Memory Consolidation ────────────────────────────────────────────────────
export { MemoryConsolidator } from './memory-consolidator.js';
export type {
  SummarizeFn,
  ConsolidationResult,
  ConsolidationOptions,
  ChangeLogEntry,
  Contradiction,
  PromotionCandidate,
} from './memory-consolidator.js';

// ─── Memory Engine (Main Entry Point) ────────────────────────────────────────
export { MemoryEngine } from './memory-engine.js';
export type {
  MemoryEngineConfig,
  RecallOptions,
  EntityProfile,
  MemoryStats,
  TimelineEntry,
} from './memory-engine.js';
