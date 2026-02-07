import type { KnowledgeGraph } from './knowledge-graph.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MemoryFragment {
  content: string;
  source: string;
  timestamp: string;
  score: number;
  tokens: number;
  metadata?: Record<string, unknown>;
}

export interface RankOptions {
  recencyWeight?: number;
  relevanceWeight?: number;
  connectionsWeight?: number;
  frequencyWeight?: number;
  diversityPenalty?: number;
  prioritySources?: string[];
  temporalHints?: string[];
}

export interface RankedFragment extends MemoryFragment {
  rank: number;
  signals: {
    relevance: number;
    recency: number;
    connections: number;
    frequency: number;
    diversityPenalty: number;
  };
}

// ─── Context Ranker ─────────────────────────────────────────────────────────

export class ContextRanker {
  private graph: KnowledgeGraph;

  constructor(graph: KnowledgeGraph) {
    this.graph = graph;
  }

  /**
   * Rank and select memory fragments using MMR (Maximal Marginal Relevance)
   * to balance relevance and diversity within a token budget.
   */
  rank(
    fragments: MemoryFragment[],
    query: string,
    tokenBudget: number,
    options: RankOptions = {}
  ): RankedFragment[] {
    const {
      relevanceWeight = 0.40,
      recencyWeight = 0.25,
      connectionsWeight = 0.20,
      frequencyWeight = 0.15,
      diversityPenalty = 0.3,
      prioritySources,
      temporalHints,
    } = options;

    if (fragments.length === 0) return [];

    // Find query-related entities for connection scoring
    const queryEntities = this.graph.findEntities(query);
    const connectedNames = new Set<string>();
    for (const entity of queryEntities) {
      connectedNames.add(entity.name.toLowerCase());
      const connected = this.graph.getConnectedEntities(entity.id, 1);
      for (const c of connected) {
        connectedNames.add(c.name.toLowerCase());
      }
    }

    // Detect temporal hints in query
    const wantsRecent = temporalHints?.length
      ? true
      : /\b(today|heute|recently|kuerzlich|just|gerade|latest|newest|aktuell|this week|diese woche|yesterday|gestern)\b/i.test(query);

    // Score each fragment
    const scored: RankedFragment[] = fragments.map(fragment => {
      const relevance = fragment.score;
      let recency = this.computeRecency(fragment.timestamp);
      const connections = this.computeConnections(fragment.content, connectedNames);
      const frequency = this.computeFrequency(fragment.content);

      // Apply temporal boost if query hints at recency
      if (wantsRecent) {
        recency = Math.pow(recency, 0.5); // Boost recency score (square root = less decay)
      }

      // Priority source boost
      let sourceBoost = 1.0;
      if (prioritySources?.includes(fragment.source)) {
        sourceBoost = 1.5;
      }
      // MEMORY.md always gets priority
      if (fragment.source === 'MEMORY.md' || fragment.source === 'long-term') {
        sourceBoost = Math.max(sourceBoost, 1.3);
      }

      const totalScore = (
        relevance * relevanceWeight +
        recency * recencyWeight +
        connections * connectionsWeight +
        frequency * frequencyWeight
      ) * sourceBoost;

      return {
        ...fragment,
        score: totalScore,
        rank: 0,
        signals: {
          relevance,
          recency,
          connections,
          frequency,
          diversityPenalty: 0,
        },
      };
    });

    // Sort by initial score
    scored.sort((a, b) => b.score - a.score);

    // MMR selection: iteratively pick the best fragment that balances relevance and diversity
    const selected: RankedFragment[] = [];
    const remaining = [...scored];
    let usedTokens = 0;
    let rank = 1;

    while (remaining.length > 0 && usedTokens < tokenBudget) {
      let bestIdx = 0;
      let bestMMRScore = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i]!;

        // Skip if it would exceed budget
        if (usedTokens + candidate.tokens > tokenBudget) continue;

        // Calculate diversity penalty: similarity to already-selected fragments
        let maxSimilarity = 0;
        for (const sel of selected) {
          const sim = this.fragmentSimilarity(candidate.content, sel.content);
          maxSimilarity = Math.max(maxSimilarity, sim);
        }

        // MMR score = relevance - diversity_penalty * max_similarity_to_selected
        const mmrScore = candidate.score - diversityPenalty * maxSimilarity;

        if (mmrScore > bestMMRScore) {
          bestMMRScore = mmrScore;
          bestIdx = i;
        }
      }

      const best = remaining[bestIdx]!;
      if (usedTokens + best.tokens > tokenBudget) break;

      // Calculate actual diversity penalty for the selected fragment
      let maxSim = 0;
      for (const sel of selected) {
        maxSim = Math.max(maxSim, this.fragmentSimilarity(best.content, sel.content));
      }

      best.rank = rank++;
      best.signals.diversityPenalty = maxSim;
      best.score = bestMMRScore;
      selected.push(best);
      usedTokens += best.tokens;
      remaining.splice(bestIdx, 1);
    }

    return selected;
  }

  /**
   * Decompose a complex query into sub-queries for better coverage.
   */
  decomposeQuery(query: string): string[] {
    // Split on conjunctions and question words
    const parts = query
      .split(/\b(and|und|also|sowie|,)\b/i)
      .map(p => p.trim())
      .filter(p => p.length > 3 && !/^(and|und|also|sowie|,)$/i.test(p));

    return parts.length > 1 ? parts : [query];
  }

  // ─── Scoring Functions ──────────────────────────────────────────────────────

  private computeRecency(timestamp: string): number {
    const ageMs = Date.now() - new Date(timestamp).getTime();
    const halfLifeMs = 24 * 3600_000; // 24-hour half-life
    return Math.exp(-ageMs * Math.LN2 / halfLifeMs);
  }

  private computeConnections(content: string, connectedNames: Set<string>): number {
    if (connectedNames.size === 0) return 0;

    const contentLower = content.toLowerCase();
    let matches = 0;
    for (const name of connectedNames) {
      if (contentLower.includes(name)) matches++;
    }
    return Math.min(matches / Math.max(connectedNames.size, 1), 1.0);
  }

  private computeFrequency(content: string): number {
    const entities = this.graph.findEntities('');
    let totalMentions = 0;
    let matchCount = 0;
    const contentLower = content.toLowerCase();

    for (const entity of entities.slice(0, 50)) { // Limit to top 50 entities for performance
      if (contentLower.includes(entity.name.toLowerCase())) {
        totalMentions += entity.mentionCount;
        matchCount++;
      }
    }

    if (matchCount === 0) return 0;
    return Math.min((totalMentions / matchCount) / 100, 1.0);
  }

  /**
   * Token-level Jaccard similarity between two text fragments.
   */
  private fragmentSimilarity(a: string, b: string): number {
    const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(t => t.length > 2));
    const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(t => t.length > 2));

    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    let intersection = 0;
    for (const t of tokensA) {
      if (tokensB.has(t)) intersection++;
    }

    return intersection / (tokensA.size + tokensB.size - intersection);
  }
}
