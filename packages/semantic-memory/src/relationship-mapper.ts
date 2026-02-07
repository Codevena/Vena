import type { Relationship } from '@vena/shared';
import type { KnowledgeGraph } from './knowledge-graph.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Predefined relationship type taxonomy with semantic metadata.
 */
export interface RelationshipTypeMeta {
  type: string;
  label: string;
  bidirectional: boolean;
  inverseType?: string;      // e.g., "manages" -> inverse is "managed_by"
  transitiveThrough?: string[]; // types this can chain through
  decayRate: number;         // 0-1, how fast this type decays (0 = never, 1 = fastest)
}

export interface ClusterResult {
  clusterId: string;
  entities: string[];      // entity IDs
  density: number;         // internal connection density
  centralEntity: string;   // most connected entity in the cluster
}

export interface InferredRelationship {
  sourceId: string;
  targetId: string;
  type: string;
  confidence: number;
  reason: string;
  via: string[];  // entity IDs in the inference chain
}

export interface RelationshipPath {
  entityIds: string[];
  relationships: Relationship[];
  totalWeight: number;
}

// ─── Relationship Type Registry ─────────────────────────────────────────────

const RELATIONSHIP_TYPES: RelationshipTypeMeta[] = [
  { type: 'works_on', label: 'works on', bidirectional: false, inverseType: 'worked_on_by', transitiveThrough: [], decayRate: 0.3 },
  { type: 'knows', label: 'knows', bidirectional: true, decayRate: 0.1 },
  { type: 'part_of', label: 'is part of', bidirectional: false, inverseType: 'contains', transitiveThrough: ['part_of'], decayRate: 0.05 },
  { type: 'uses', label: 'uses', bidirectional: false, inverseType: 'used_by', transitiveThrough: ['depends_on'], decayRate: 0.3 },
  { type: 'created', label: 'created', bidirectional: false, inverseType: 'created_by', transitiveThrough: [], decayRate: 0.0 },
  { type: 'manages', label: 'manages', bidirectional: false, inverseType: 'managed_by', transitiveThrough: [], decayRate: 0.2 },
  { type: 'depends_on', label: 'depends on', bidirectional: false, inverseType: 'depended_on_by', transitiveThrough: ['depends_on'], decayRate: 0.15 },
  { type: 'opposes', label: 'opposes', bidirectional: true, decayRate: 0.2 },
  { type: 'supports', label: 'supports', bidirectional: false, inverseType: 'supported_by', transitiveThrough: [], decayRate: 0.2 },
  { type: 'located_in', label: 'located in', bidirectional: false, inverseType: 'location_of', transitiveThrough: ['located_in'], decayRate: 0.05 },
  { type: 'happened_at', label: 'happened at', bidirectional: false, decayRate: 0.0 },
  { type: 'scheduled_for', label: 'scheduled for', bidirectional: false, decayRate: 0.5 },
  { type: 'prefers', label: 'prefers', bidirectional: false, decayRate: 0.3 },
  { type: 'related_to', label: 'related to', bidirectional: true, decayRate: 0.4 },
  { type: 'inferred', label: 'inferred', bidirectional: false, decayRate: 0.6 },
];

// ─── Relationship Mapper ────────────────────────────────────────────────────

export class RelationshipMapper {
  private graph: KnowledgeGraph;
  private typeRegistry: Map<string, RelationshipTypeMeta>;

  constructor(graph: KnowledgeGraph) {
    this.graph = graph;
    this.typeRegistry = new Map(RELATIONSHIP_TYPES.map(t => [t.type, t]));
  }

  // ─── Type Registry ──────────────────────────────────────────────────────

  getTypeMeta(type: string): RelationshipTypeMeta | undefined {
    return this.typeRegistry.get(type);
  }

  getAllTypes(): RelationshipTypeMeta[] {
    return [...this.typeRegistry.values()];
  }

  registerType(meta: RelationshipTypeMeta): void {
    this.typeRegistry.set(meta.type, meta);
  }

  isBidirectional(type: string): boolean {
    return this.typeRegistry.get(type)?.bidirectional ?? false;
  }

  getInverseType(type: string): string | undefined {
    return this.typeRegistry.get(type)?.inverseType;
  }

  // ─── Strength Management ────────────────────────────────────────────────

  strengthenRelationship(id: string, amount: number = 0.1): void {
    const rel = this.graph.getRelationshipById(id);
    if (!rel) return;

    const newWeight = Math.min(rel.weight + amount, 10.0);
    this.graph.updateRelationship(id, {
      weight: newWeight,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Decay all relationships based on their age and type-specific decay rates.
   * Uses configurable half-life: after halfLifeDays, relationship weight is halved.
   */
  decayRelationships(options: {
    threshold?: number;
    halfLifeDays?: number;
    removeBelow?: number;
  } = {}): { decayed: number; removed: number } {
    const {
      threshold = 0.1,
      halfLifeDays = 30,
      removeBelow = 0.05,
    } = options;

    const now = Date.now();
    const halfLifeMs = halfLifeDays * 24 * 3600_000;
    const entities = this.graph.getAllEntities();
    const visited = new Set<string>();
    let decayed = 0;
    let removed = 0;

    for (const entity of entities) {
      const rels = this.graph.getRelationships(entity.id);
      for (const rel of rels) {
        if (visited.has(rel.id)) continue;
        visited.add(rel.id);

        const typeMeta = this.typeRegistry.get(rel.type);
        const typeDecayRate = typeMeta?.decayRate ?? 0.3;

        // Skip types that don't decay
        if (typeDecayRate === 0) continue;

        const ageMs = now - new Date(rel.timestamp).getTime();
        // Exponential decay adjusted by type-specific rate
        const decayFactor = Math.exp(-ageMs * Math.LN2 * typeDecayRate / halfLifeMs);
        const newWeight = rel.weight * decayFactor;

        if (newWeight < removeBelow) {
          this.graph.deleteRelationship(rel.id);
          removed++;
        } else if (newWeight < rel.weight - 0.01) {
          this.graph.updateRelationship(rel.id, { weight: newWeight });
          decayed++;
        }
      }
    }

    return { decayed, removed };
  }

  // ─── Path Finding ───────────────────────────────────────────────────────

  /**
   * Find all paths between two entities up to a maximum length.
   * Returns paths sorted by total weight (strongest first).
   */
  findPaths(
    fromId: string,
    toId: string,
    maxLength: number = 4
  ): RelationshipPath[] {
    const paths: RelationshipPath[] = [];

    const dfs = (
      currentId: string,
      targetId: string,
      visited: Set<string>,
      currentPath: string[],
      currentRels: Relationship[],
      depth: number
    ) => {
      if (currentId === targetId && currentPath.length > 1) {
        const totalWeight = currentRels.reduce((sum, r) => sum + r.weight, 0) / currentRels.length;
        paths.push({
          entityIds: [...currentPath],
          relationships: [...currentRels],
          totalWeight,
        });
        return;
      }

      if (depth >= maxLength) return;

      const rels = this.graph.getRelationships(currentId);
      for (const rel of rels) {
        const neighbor = rel.sourceId === currentId ? rel.targetId : rel.sourceId;
        if (visited.has(neighbor)) continue;

        visited.add(neighbor);
        currentPath.push(neighbor);
        currentRels.push(rel);

        dfs(neighbor, targetId, visited, currentPath, currentRels, depth + 1);

        currentPath.pop();
        currentRels.pop();
        visited.delete(neighbor);
      }
    };

    const visited = new Set<string>([fromId]);
    dfs(fromId, toId, visited, [fromId], [], 0);

    return paths.sort((a, b) => b.totalWeight - a.totalWeight);
  }

  // ─── Cluster Detection ──────────────────────────────────────────────────

  /**
   * Detect clusters of tightly connected entities using a label propagation algorithm.
   */
  detectClusters(minClusterSize: number = 2): ClusterResult[] {
    const entities = this.graph.getAllEntities();
    if (entities.length === 0) return [];

    // Initialize: each entity is its own cluster
    const labels = new Map<string, string>();
    for (const entity of entities) {
      labels.set(entity.id, entity.id);
    }

    // Iterative label propagation
    const maxIterations = 20;
    for (let iter = 0; iter < maxIterations; iter++) {
      let changed = false;
      // Shuffle entity order for each iteration
      const shuffled = [...entities].sort(() => Math.random() - 0.5);

      for (const entity of shuffled) {
        const rels = this.graph.getRelationships(entity.id);
        if (rels.length === 0) continue;

        // Count weighted labels from neighbors
        const labelWeights = new Map<string, number>();
        for (const rel of rels) {
          const neighbor = rel.sourceId === entity.id ? rel.targetId : rel.sourceId;
          const neighborLabel = labels.get(neighbor);
          if (neighborLabel) {
            labelWeights.set(neighborLabel, (labelWeights.get(neighborLabel) ?? 0) + rel.weight);
          }
        }

        // Pick the label with the highest total weight
        let bestLabel = labels.get(entity.id)!;
        let bestWeight = 0;
        for (const [label, weight] of labelWeights) {
          if (weight > bestWeight) {
            bestWeight = weight;
            bestLabel = label;
          }
        }

        if (bestLabel !== labels.get(entity.id)) {
          labels.set(entity.id, bestLabel);
          changed = true;
        }
      }

      if (!changed) break;
    }

    // Group entities by label
    const clusterMap = new Map<string, string[]>();
    for (const [entityId, label] of labels) {
      const existing = clusterMap.get(label) ?? [];
      existing.push(entityId);
      clusterMap.set(label, existing);
    }

    // Build cluster results
    const clusters: ClusterResult[] = [];
    for (const [clusterId, entityIds] of clusterMap) {
      if (entityIds.length < minClusterSize) continue;

      // Calculate internal density
      let internalEdges = 0;
      const entitySet = new Set(entityIds);
      for (const entityId of entityIds) {
        const rels = this.graph.getRelationships(entityId);
        for (const rel of rels) {
          const neighbor = rel.sourceId === entityId ? rel.targetId : rel.sourceId;
          if (entitySet.has(neighbor)) {
            internalEdges++;
          }
        }
      }
      // Each edge counted twice (from both sides)
      internalEdges = Math.floor(internalEdges / 2);
      const maxEdges = entityIds.length * (entityIds.length - 1) / 2;
      const density = maxEdges > 0 ? internalEdges / maxEdges : 0;

      // Find central entity (most connections within cluster)
      let centralEntity = entityIds[0]!;
      let maxConnections = 0;
      for (const entityId of entityIds) {
        const rels = this.graph.getRelationships(entityId);
        const clusterConnections = rels.filter(r =>
          entitySet.has(r.sourceId === entityId ? r.targetId : r.sourceId)
        ).length;
        if (clusterConnections > maxConnections) {
          maxConnections = clusterConnections;
          centralEntity = entityId;
        }
      }

      clusters.push({
        clusterId,
        entities: entityIds,
        density,
        centralEntity,
      });
    }

    return clusters.sort((a, b) => b.entities.length - a.entities.length);
  }

  // ─── Relationship Inference ─────────────────────────────────────────────

  /**
   * Infer new relationships from existing patterns.
   * Uses transitive reasoning through relationship chains.
   */
  inferRelationships(entityId: string, maxInferences: number = 10): InferredRelationship[] {
    const directRels = this.graph.getRelationships(entityId);
    const directNeighbors = new Set<string>();
    const inferred: InferredRelationship[] = [];

    for (const rel of directRels) {
      const neighbor = rel.sourceId === entityId ? rel.targetId : rel.sourceId;
      directNeighbors.add(neighbor);
    }

    // Transitive inference: if A->B and B->C, maybe A->C
    for (const neighborId of directNeighbors) {
      const neighborRels = this.graph.getRelationships(neighborId);

      for (const rel of neighborRels) {
        const transTarget = rel.sourceId === neighborId ? rel.targetId : rel.sourceId;

        // Skip self and already-connected
        if (transTarget === entityId || directNeighbors.has(transTarget)) continue;

        // Find the direct relationship to this neighbor
        const directRel = directRels.find(
          r => r.sourceId === neighborId || r.targetId === neighborId
        );
        if (!directRel) continue;

        // Check if the type supports transitive inference
        const typeMeta = this.typeRegistry.get(directRel.type);
        const canTransit = typeMeta?.transitiveThrough?.includes(rel.type) ?? false;

        // Calculate inference confidence
        const directWeight = directRel.weight;
        const transitWeight = rel.weight;
        let confidence: number;
        let inferredType: string;
        let reason: string;

        if (canTransit) {
          // Strong inference through known transitive types
          confidence = Math.min(directWeight, transitWeight) * 0.6;
          inferredType = directRel.type;
          reason = `Transitive ${directRel.type}: if A ${directRel.type} B and B ${rel.type} C, then A likely ${directRel.type} C`;
        } else if (directRel.type === 'uses' && rel.type === 'depends_on') {
          // Special pattern: if A uses B and B depends_on C, A likely needs C
          confidence = Math.min(directWeight, transitWeight) * 0.4;
          inferredType = 'depends_on';
          reason = `If entity uses ${neighborId} which depends on ${transTarget}, entity likely also needs ${transTarget}`;
        } else if (directRel.type === 'works_on' && rel.type === 'works_on') {
          // Coworker inference
          confidence = Math.min(directWeight, transitWeight) * 0.3;
          inferredType = 'knows';
          reason = `Both work on the same project via ${neighborId}`;
        } else {
          // Generic transitive with low confidence
          confidence = Math.min(directWeight, transitWeight) * 0.15;
          inferredType = 'related_to';
          reason = `Connected through ${neighborId} (${directRel.type} -> ${rel.type})`;
        }

        if (confidence > 0.1) {
          inferred.push({
            sourceId: entityId,
            targetId: transTarget,
            type: inferredType,
            confidence,
            reason,
            via: [neighborId],
          });
        }
      }
    }

    // Deduplicate by target, keeping strongest
    const byTarget = new Map<string, InferredRelationship>();
    for (const rel of inferred) {
      const existing = byTarget.get(rel.targetId);
      if (!existing || rel.confidence > existing.confidence) {
        byTarget.set(rel.targetId, rel);
      }
    }

    return Array.from(byTarget.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxInferences);
  }

  /**
   * Get the strongest relationships for an entity.
   */
  getStrongest(entityId: string, limit: number = 10): Relationship[] {
    const rels = this.graph.getRelationships(entityId);
    return rels.sort((a, b) => b.weight - a.weight).slice(0, limit);
  }

  /**
   * Describe the relationship between two entities in natural language.
   */
  describeRelationship(entityAId: string, entityBId: string): string {
    const entityA = this.graph.getEntity(entityAId);
    const entityB = this.graph.getEntity(entityBId);
    if (!entityA || !entityB) return 'No relationship found.';

    const directRels = this.graph.getRelationshipBetween(entityAId, entityBId);
    if (directRels.length === 0) {
      // Try to find a path
      const path = this.graph.shortestPath(entityAId, entityBId, 4);
      if (!path) return `No connection found between ${entityA.name} and ${entityB.name}.`;
      return `${entityA.name} and ${entityB.name} are indirectly connected through ${path.length - 2} intermediary entities.`;
    }

    const descriptions = directRels.map(rel => {
      const meta = this.typeRegistry.get(rel.type);
      const label = meta?.label ?? rel.type;
      const isForward = rel.sourceId === entityAId;
      const subject = isForward ? entityA.name : entityB.name;
      const object = isForward ? entityB.name : entityA.name;
      const strength = rel.weight >= 5 ? 'strongly' : rel.weight >= 2 ? 'moderately' : 'weakly';
      const contextSuffix = rel.context ? ` (${rel.context})` : '';
      return `${subject} ${strength} ${label} ${object}${contextSuffix}`;
    });

    return descriptions.join('; ');
  }
}
