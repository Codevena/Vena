import type { Entity, Relationship } from '@vena/shared';
import { MemoryError } from '@vena/shared';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ExtractFn = (prompt: string) => Promise<string>;

export interface SentimentExtraction {
  entityName: string;
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  opinion: string;
  confidence: number;
}

export interface TemporalExtraction {
  entityName: string;
  temporal: string;         // raw temporal expression ("last week", "seit 3 Jahren")
  normalizedDate?: string;  // ISO date if resolvable
  type: 'point' | 'range' | 'duration' | 'relative';
}

export interface CoreferenceResolution {
  pronoun: string;           // "he", "it", "der User", "ich"
  resolvedEntity: string;    // the entity name it refers to
  confidence: number;
}

export interface ExtractionResult {
  entities: Partial<Entity>[];
  relationships: Partial<Relationship>[];
  sentiments: SentimentExtraction[];
  temporals: TemporalExtraction[];
  coreferences: CoreferenceResolution[];
}

export interface ExtractionOptions {
  /** Enable multi-pass extraction (default: true) */
  multiPass?: boolean;
  /** Enable coreference resolution (default: true) */
  resolveCoreferences?: boolean;
  /** Enable sentiment extraction (default: true) */
  extractSentiments?: boolean;
  /** Enable temporal extraction (default: true) */
  extractTemporals?: boolean;
  /** Minimum confidence threshold to include results (default: 0.3) */
  minConfidence?: number;
  /** Agent/user context for coreference resolution */
  speakerContext?: {
    userName?: string;
    agentName?: string;
  };
}

// ─── Entity Extractor ───────────────────────────────────────────────────────

export class EntityExtractor {
  private extractFn: ExtractFn;
  private processedHashes: Set<string> = new Set();

  constructor(extractFn: ExtractFn) {
    this.extractFn = extractFn;
  }

  /**
   * Multi-pass entity extraction with coreference resolution, sentiment, and temporal extraction.
   */
  async extractEntities(
    text: string,
    existingEntities: Entity[] = [],
    options: ExtractionOptions = {}
  ): Promise<ExtractionResult> {
    const {
      multiPass = true,
      resolveCoreferences = true,
      extractSentiments = true,
      extractTemporals = true,
      minConfidence = 0.3,
      speakerContext,
    } = options;

    // Incremental extraction: skip already processed text
    const textHash = this.hashText(text);
    if (this.processedHashes.has(textHash)) {
      return { entities: [], relationships: [], sentiments: [], temporals: [], coreferences: [] };
    }

    const existingNames = existingEntities.map(e => `${e.name} (${e.type})`).join(', ');
    const speakerInfo = speakerContext
      ? `\nSpeaker context: User name is "${speakerContext.userName ?? 'unknown'}", AI assistant name is "${speakerContext.agentName ?? 'unknown'}". When the user says "ich" or "I" or "my", it refers to "${speakerContext.userName ?? 'the user'}". When "du"/"you" is addressed to the assistant, it refers to "${speakerContext.agentName ?? 'the assistant'}".`
      : '';

    // ─── Pass 1: Entity & Relationship Extraction ───────────────────────

    const pass1Prompt = `You are an expert knowledge graph extraction system. Extract entities and relationships from the following conversation text.

RULES:
1. Identify ALL named entities: people, projects, technologies, concepts, places, files, events, organizations, tools, languages
2. For each entity, determine its type: person, project, concept, place, file, event, or custom
3. Extract meaningful attributes (skills, preferences, descriptions, roles)
4. Identify relationships between entities with specific relationship types
5. Assign a confidence score (0.0-1.0) based on how certain you are about each extraction
6. Normalize entity names (capitalize properly, use full names when possible)

Known entities already in the graph: ${existingNames || 'none'}
${speakerInfo}

RELATIONSHIP TYPES to use:
- works_on: person works on project/concept
- knows: person knows person/concept
- uses: entity uses technology/tool
- part_of: entity is part of another entity
- created: person created entity
- manages: person manages project/entity
- depends_on: entity depends on another
- located_in: entity is located in place
- opposes: entity opposes another
- supports: entity supports another
- prefers: person prefers something
- scheduled_for: event is scheduled
- happened_at: event happened at time/place

Text to analyze:
"""
${text}
"""

Return ONLY valid JSON (no markdown, no code fences):
{
  "entities": [
    {
      "type": "person|project|concept|place|file|event|custom",
      "name": "Canonical Name",
      "attributes": {"key": "value"},
      "confidence": 0.9,
      "aliases": ["alternative name", "nickname"],
      "category": "optional category like 'Programming Language', 'Framework'"
    }
  ],
  "relationships": [
    {
      "sourceName": "Entity A",
      "targetName": "Entity B",
      "type": "relationship_type",
      "context": "brief context of this relationship",
      "confidence": 0.8,
      "bidirectional": false,
      "startDate": "optional ISO date",
      "endDate": "optional ISO date"
    }
  ]
}`;

    let pass1Result: Pass1Result;
    try {
      const rawResponse = await this.extractFn(pass1Prompt);
      pass1Result = this.parsePass1Response(rawResponse);
    } catch (error) {
      throw new MemoryError(`Entity extraction pass 1 failed: ${error}`);
    }

    // ─── Pass 2: Coreference Resolution (optional) ──────────────────────

    let coreferences: CoreferenceResolution[] = [];
    if (multiPass && resolveCoreferences) {
      coreferences = await this.resolveCoreferencePass(text, pass1Result.entities, existingEntities, speakerContext);
    }

    // ─── Pass 3: Sentiment & Temporal Extraction (optional) ─────────────

    let sentiments: SentimentExtraction[] = [];
    let temporals: TemporalExtraction[] = [];
    if (multiPass && (extractSentiments || extractTemporals)) {
      const pass3 = await this.extractSentimentAndTemporal(
        text,
        pass1Result.entities.map(e => e.name).filter((n): n is string => !!n),
        extractSentiments,
        extractTemporals
      );
      sentiments = pass3.sentiments;
      temporals = pass3.temporals;
    }

    // ─── Post-Processing: Deduplication & Filtering ─────────────────────

    const deduped = this.deduplicateEntities(pass1Result, existingEntities);

    // Apply coreference resolutions to relationships
    const resolvedRelationships = this.applyCoreferenceToRelationships(
      deduped.relationships,
      coreferences
    );

    // Filter by confidence
    const filteredEntities = deduped.entities.filter(
      e => (e.confidence ?? 0.5) >= minConfidence
    );
    const filteredRelationships = resolvedRelationships.filter(
      r => ((r as unknown as { confidence?: number }).confidence ?? 0.5) >= minConfidence
    );
    const filteredSentiments = sentiments.filter(s => s.confidence >= minConfidence);

    // Mark text as processed
    this.processedHashes.add(textHash);

    return {
      entities: filteredEntities,
      relationships: filteredRelationships,
      sentiments: filteredSentiments,
      temporals,
      coreferences,
    };
  }

  /**
   * Extract entities from multiple texts with smart batching.
   * Groups messages by topic proximity before extraction for better context.
   */
  async extractBatch(
    texts: string[],
    existingEntities: Entity[] = [],
    options: ExtractionOptions = {}
  ): Promise<ExtractionResult> {
    const allEntities: Partial<Entity>[] = [];
    const allRelationships: Partial<Relationship>[] = [];
    const allSentiments: SentimentExtraction[] = [];
    const allTemporals: TemporalExtraction[] = [];
    const allCoreferences: CoreferenceResolution[] = [];
    let knownEntities = [...existingEntities];

    // Group consecutive messages into chunks for better context
    const chunks = this.groupMessagesByTopic(texts);

    for (const chunk of chunks) {
      const combinedText = chunk.join('\n\n---\n\n');
      const result = await this.extractEntities(combinedText, knownEntities, options);

      allEntities.push(...result.entities);
      allRelationships.push(...result.relationships);
      allSentiments.push(...result.sentiments);
      allTemporals.push(...result.temporals);
      allCoreferences.push(...result.coreferences);

      // Add newly discovered entities as "known" for subsequent chunks
      for (const e of result.entities) {
        if (e.name && e.type) {
          knownEntities.push({
            id: '',
            name: e.name,
            type: e.type,
            attributes: e.attributes ?? {},
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            mentionCount: 1,
            confidence: e.confidence ?? 0.5,
          });
        }
      }
    }

    return {
      entities: allEntities,
      relationships: allRelationships,
      sentiments: allSentiments,
      temporals: allTemporals,
      coreferences: allCoreferences,
    };
  }

  /**
   * Clear the processed text cache (for reprocessing).
   */
  clearProcessedCache(): void {
    this.processedHashes.clear();
  }

  // ─── Private: Coreference Resolution ──────────────────────────────────

  private async resolveCoreferencePass(
    text: string,
    extractedEntities: Partial<Entity>[],
    existingEntities: Entity[],
    speakerContext?: { userName?: string; agentName?: string }
  ): Promise<CoreferenceResolution[]> {
    const entityNames = [
      ...extractedEntities.map(e => e.name).filter(Boolean),
      ...existingEntities.map(e => e.name),
    ];

    if (entityNames.length === 0) return [];

    const prompt = `Resolve pronoun and coreference mentions in this text to their actual entities.

Known entities: ${entityNames.join(', ')}
${speakerContext?.userName ? `The user's name is: ${speakerContext.userName}` : ''}
${speakerContext?.agentName ? `The AI assistant's name is: ${speakerContext.agentName}` : ''}

Common patterns:
- "ich", "I", "my", "mein" -> the user (${speakerContext?.userName ?? 'unknown'})
- "he", "she", "er", "sie", "it", "es" -> resolve from context
- "der User", "the user" -> ${speakerContext?.userName ?? 'the user'}
- "du", "you" -> depends on who is being addressed

Text:
"""
${text}
"""

Return ONLY valid JSON (no markdown):
{
  "coreferences": [
    {"pronoun": "the pronoun or reference", "resolvedEntity": "actual entity name", "confidence": 0.8}
  ]
}`;

    try {
      const rawResponse = await this.extractFn(prompt);
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]) as {
        coreferences?: Array<{ pronoun?: string; resolvedEntity?: string; confidence?: number }>;
      };

      return (parsed.coreferences ?? [])
        .filter(c => c.pronoun && c.resolvedEntity)
        .map(c => ({
          pronoun: c.pronoun!,
          resolvedEntity: c.resolvedEntity!,
          confidence: c.confidence ?? 0.5,
        }));
    } catch {
      return [];
    }
  }

  // ─── Private: Sentiment & Temporal ────────────────────────────────────

  private async extractSentimentAndTemporal(
    text: string,
    entityNames: string[],
    doSentiment: boolean,
    doTemporal: boolean
  ): Promise<{ sentiments: SentimentExtraction[]; temporals: TemporalExtraction[] }> {
    const parts: string[] = [];
    if (doSentiment) {
      parts.push(`"sentiments": [{"entityName": "...", "sentiment": "positive|negative|neutral|mixed", "opinion": "what is said/felt about the entity", "confidence": 0.8}]`);
    }
    if (doTemporal) {
      parts.push(`"temporals": [{"entityName": "...", "temporal": "raw temporal expression", "normalizedDate": "ISO date if possible or null", "type": "point|range|duration|relative"}]`);
    }

    const prompt = `Analyze this text for ${doSentiment ? 'sentiments/opinions about entities' : ''}${doSentiment && doTemporal ? ' and ' : ''}${doTemporal ? 'temporal references' : ''}.

Known entities: ${entityNames.join(', ') || 'none'}

Text:
"""
${text}
"""

Return ONLY valid JSON (no markdown):
{${parts.join(',\n')}}`;

    try {
      const rawResponse = await this.extractFn(prompt);
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { sentiments: [], temporals: [] };

      const parsed = JSON.parse(jsonMatch[0]) as {
        sentiments?: Array<{
          entityName?: string;
          sentiment?: string;
          opinion?: string;
          confidence?: number;
        }>;
        temporals?: Array<{
          entityName?: string;
          temporal?: string;
          normalizedDate?: string;
          type?: string;
        }>;
      };

      const sentiments: SentimentExtraction[] = (parsed.sentiments ?? [])
        .filter(s => s.entityName && s.sentiment)
        .map(s => ({
          entityName: s.entityName!,
          sentiment: (s.sentiment as SentimentExtraction['sentiment']) ?? 'neutral',
          opinion: s.opinion ?? '',
          confidence: s.confidence ?? 0.5,
        }));

      const temporals: TemporalExtraction[] = (parsed.temporals ?? [])
        .filter(t => t.entityName && t.temporal)
        .map(t => ({
          entityName: t.entityName!,
          temporal: t.temporal!,
          normalizedDate: t.normalizedDate || undefined,
          type: (t.type as TemporalExtraction['type']) ?? 'relative',
        }));

      return { sentiments, temporals };
    } catch {
      return { sentiments: [], temporals: [] };
    }
  }

  // ─── Private: Parsing & Processing ────────────────────────────────────

  private parsePass1Response(raw: string): Pass1Result {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { entities: [], relationships: [] };
    }

    try {
      const data = JSON.parse(jsonMatch[0]) as {
        entities?: Array<{
          type?: string;
          name?: string;
          attributes?: Record<string, unknown>;
          confidence?: number;
          aliases?: string[];
          category?: string;
        }>;
        relationships?: Array<{
          sourceName?: string;
          targetName?: string;
          type?: string;
          context?: string;
          confidence?: number;
          bidirectional?: boolean;
          startDate?: string;
          endDate?: string;
        }>;
      };

      const entities: (Partial<Entity> & { aliases?: string[]; category?: string })[] =
        (data.entities ?? []).map(e => ({
          type: e.type as Entity['type'],
          name: e.name,
          attributes: e.attributes ?? {},
          confidence: e.confidence ?? 0.5,
          aliases: e.aliases,
          category: e.category,
        }));

      const relationships: Partial<Relationship>[] = (data.relationships ?? []).map(r => ({
        type: r.type,
        context: r.context ?? '',
        sourceId: r.sourceName,  // temporary: resolved later
        targetId: r.targetName,  // temporary: resolved later
        weight: r.confidence ?? 0.5,
      }));

      return { entities, relationships };
    } catch {
      return { entities: [], relationships: [] };
    }
  }

  private deduplicateEntities(
    result: Pass1Result,
    existingEntities: Entity[]
  ): { entities: Partial<Entity>[]; relationships: Partial<Relationship>[] } {
    const deduplicated: Partial<Entity>[] = [];

    for (const newEntity of result.entities) {
      if (!newEntity.name) continue;

      const match = existingEntities.find(
        existing => this.nameSimilarity(existing.name, newEntity.name!) > 0.85
      );

      if (match) {
        // Merge with existing entity: keep existing ID, merge attributes
        deduplicated.push({
          ...newEntity,
          id: match.id,
          name: match.name, // Keep canonical name
          attributes: { ...match.attributes, ...newEntity.attributes },
          confidence: Math.max(match.confidence, newEntity.confidence ?? 0.5),
        });
      } else {
        deduplicated.push(newEntity);
      }
    }

    return { entities: deduplicated, relationships: result.relationships };
  }

  private applyCoreferenceToRelationships(
    relationships: Partial<Relationship>[],
    coreferences: CoreferenceResolution[]
  ): Partial<Relationship>[] {
    if (coreferences.length === 0) return relationships;

    const corefMap = new Map<string, string>();
    for (const coref of coreferences) {
      corefMap.set(coref.pronoun.toLowerCase(), coref.resolvedEntity);
    }

    return relationships.map(rel => {
      const resolvedSource = rel.sourceId ? (corefMap.get(rel.sourceId.toLowerCase()) ?? rel.sourceId) : rel.sourceId;
      const resolvedTarget = rel.targetId ? (corefMap.get(rel.targetId.toLowerCase()) ?? rel.targetId) : rel.targetId;
      return { ...rel, sourceId: resolvedSource, targetId: resolvedTarget };
    });
  }

  private groupMessagesByTopic(texts: string[], maxGroupSize: number = 5): string[][] {
    if (texts.length <= maxGroupSize) return [texts];

    const groups: string[][] = [];
    let currentGroup: string[] = [];

    for (const text of texts) {
      currentGroup.push(text);
      if (currentGroup.length >= maxGroupSize) {
        groups.push(currentGroup);
        currentGroup = [];
      }
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    return groups;
  }

  private nameSimilarity(a: string, b: string): number {
    const la = a.toLowerCase().trim();
    const lb = b.toLowerCase().trim();
    if (la === lb) return 1.0;

    // Check if one contains the other
    if (la.includes(lb) || lb.includes(la)) return 0.9;

    // Levenshtein-based similarity for short strings
    if (la.length < 20 && lb.length < 20) {
      const distance = this.levenshteinDistance(la, lb);
      const maxLen = Math.max(la.length, lb.length);
      return maxLen > 0 ? 1 - distance / maxLen : 0;
    }

    // Token-level Jaccard for longer strings
    const setA = new Set(la.split(/\s+/));
    const setB = new Set(lb.split(/\s+/));
    const intersection = new Set([...setA].filter(c => setB.has(c)));
    const union = new Set([...setA, ...setB]);
    return intersection.size / union.size;
  }

  private levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);

    for (let i = 0; i <= m; i++) dp[i]![0] = i;
    for (let j = 0; j <= n; j++) dp[0]![j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i]![j] = Math.min(
          dp[i - 1]![j]! + 1,
          dp[i]![j - 1]! + 1,
          dp[i - 1]![j - 1]! + cost
        );
      }
    }

    return dp[m]![n]!;
  }

  private hashText(text: string): string {
    // Simple hash for deduplication (FNV-1a-like)
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
}

// ─── Internal Types ─────────────────────────────────────────────────────────

interface Pass1Result {
  entities: (Partial<Entity> & { aliases?: string[]; category?: string })[];
  relationships: Partial<Relationship>[];
}
