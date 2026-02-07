import type { MemoryFragment } from './context-ranker.js';
import type { KnowledgeGraph } from './knowledge-graph.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type SummarizeFn = (texts: string[]) => Promise<string>;

export interface ConsolidationResult {
  kept: MemoryFragment[];
  merged: MemoryFragment[];
  removed: MemoryFragment[];
  changelog: ChangeLogEntry[];
}

export interface ChangeLogEntry {
  action: 'merged' | 'removed' | 'promoted' | 'contradiction_resolved';
  description: string;
  fragments: string[];
  timestamp: string;
}

export interface Contradiction {
  a: MemoryFragment;
  b: MemoryFragment;
  reason: string;
  resolution?: 'keep_newer' | 'keep_older' | 'keep_both' | 'merge';
}

export interface PromotionCandidate {
  fragment: MemoryFragment;
  reason: string;
  score: number;
}

export interface ConsolidationOptions {
  similarityThreshold?: number;
  minMentionsForPromotion?: number;
  preserveHighImportance?: boolean;
  maxAge?: number;
}

// ─── Memory Consolidator ────────────────────────────────────────────────────

export class MemoryConsolidator {
  private summarizeFn: SummarizeFn;
  private graph?: KnowledgeGraph;
  private changelog: ChangeLogEntry[] = [];

  constructor(summarizeFn: SummarizeFn, graph?: KnowledgeGraph) {
    this.summarizeFn = summarizeFn;
    this.graph = graph;
  }

  /**
   * Consolidate memory fragments: deduplicate, merge similar, track changes.
   */
  async consolidate(
    entries: MemoryFragment[],
    options: ConsolidationOptions = {}
  ): Promise<ConsolidationResult> {
    const {
      similarityThreshold = 0.55,
      preserveHighImportance = true,
    } = options;

    // Step 1: Group by topic/entity using knowledge graph
    const topicGroups = this.groupByTopic(entries);

    // Step 2: Within each topic group, find similar entries
    const kept: MemoryFragment[] = [];
    const merged: MemoryFragment[] = [];
    const removed: MemoryFragment[] = [];
    this.changelog = [];

    for (const group of topicGroups) {
      const simGroups = this.groupBySimilarity(group, similarityThreshold);

      for (const simGroup of simGroups) {
        if (simGroup.length === 1) {
          kept.push(simGroup[0]!);
          continue;
        }

        // Check if any fragment is high-importance (shouldn't be consolidated)
        if (preserveHighImportance) {
          const highImportance = simGroup.filter(f => f.score > 0.8);
          if (highImportance.length > 0) {
            kept.push(...highImportance);
            const rest = simGroup.filter(f => f.score <= 0.8);
            if (rest.length > 0) {
              removed.push(...rest);
              this.changelog.push({
                action: 'removed',
                description: `Removed ${rest.length} redundant fragments (high-importance version kept)`,
                fragments: rest.map(f => f.content.slice(0, 50)),
                timestamp: new Date().toISOString(),
              });
            }
            continue;
          }
        }

        // Merge similar entries using LLM summarization
        const contents = simGroup.map(e => e.content);
        const summary = await this.summarizeFn(contents);

        const bestTimestamp = simGroup.reduce(
          (latest, e) => (e.timestamp > latest ? e.timestamp : latest),
          simGroup[0]!.timestamp
        );
        const bestScore = Math.max(...simGroup.map(e => e.score));

        merged.push({
          content: summary,
          source: simGroup[0]!.source,
          timestamp: bestTimestamp,
          score: bestScore,
          tokens: this.estimateTokens(summary),
        });

        removed.push(...simGroup.slice(1));

        this.changelog.push({
          action: 'merged',
          description: `Merged ${simGroup.length} similar fragments into one`,
          fragments: simGroup.map(f => f.content.slice(0, 50)),
          timestamp: new Date().toISOString(),
        });
      }
    }

    return { kept, merged, removed, changelog: this.changelog };
  }

  /**
   * Detect contradictions between memory fragments.
   * Uses both heuristic patterns and entity-based analysis.
   */
  detectContradictions(entries: MemoryFragment[]): Contradiction[] {
    const contradictions: Contradiction[] = [];

    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i]!;
        const b = entries[j]!;

        // Skip if from same timestamp (likely same conversation)
        if (a.timestamp === b.timestamp) continue;

        const reason = this.findContradiction(a.content, b.content);
        if (reason) {
          // Default resolution: prefer newer information
          const resolution: Contradiction['resolution'] = a.timestamp > b.timestamp ? 'keep_newer' : 'keep_newer';
          contradictions.push({ a, b, reason, resolution });
        }
      }
    }

    return contradictions;
  }

  /**
   * Resolve contradictions by preferring newer information.
   * Returns the fragments to keep with changes noted.
   */
  resolveContradictions(contradictions: Contradiction[]): { keep: MemoryFragment[]; discard: MemoryFragment[]; notes: string[] } {
    const keep: MemoryFragment[] = [];
    const discard: MemoryFragment[] = [];
    const notes: string[] = [];

    for (const c of contradictions) {
      const newer = c.a.timestamp > c.b.timestamp ? c.a : c.b;
      const older = c.a.timestamp > c.b.timestamp ? c.b : c.a;

      keep.push(newer);
      discard.push(older);
      notes.push(`Resolved: "${older.content.slice(0, 60)}..." superseded by "${newer.content.slice(0, 60)}..." (${c.reason})`);

      this.changelog.push({
        action: 'contradiction_resolved',
        description: c.reason,
        fragments: [older.content.slice(0, 50), newer.content.slice(0, 50)],
        timestamp: new Date().toISOString(),
      });
    }

    return { keep, discard, notes };
  }

  /**
   * Identify fragments that should be promoted to MEMORY.md.
   * Criteria: mentioned 3+ times, high confidence, user explicitly asked to remember.
   */
  promoteFrequent(entries: MemoryFragment[], options: { minMentions?: number; minScore?: number } = {}): PromotionCandidate[] {
    const { minMentions = 3, minScore = 0.5 } = options;
    const candidates: PromotionCandidate[] = [];

    // Group by content similarity
    const contentGroups = new Map<string, { count: number; fragments: MemoryFragment[] }>();
    for (const entry of entries) {
      const key = this.contentFingerprint(entry.content);
      const existing = contentGroups.get(key);
      if (existing) {
        existing.count++;
        existing.fragments.push(entry);
      } else {
        contentGroups.set(key, { count: 1, fragments: [entry] });
      }
    }

    // Promote frequently mentioned
    for (const [, group] of contentGroups) {
      if (group.count >= minMentions) {
        const best = group.fragments.sort((a, b) => b.score - a.score)[0]!;
        candidates.push({
          fragment: best,
          reason: `Mentioned ${group.count} times across conversations`,
          score: best.score * (1 + group.count * 0.1),
        });
      }
    }

    // Promote high-score entries
    for (const entry of entries) {
      if (entry.score >= minScore) {
        const key = this.contentFingerprint(entry.content);
        if (!candidates.some(c => this.contentFingerprint(c.fragment.content) === key)) {
          candidates.push({
            fragment: entry,
            reason: `High relevance score (${entry.score.toFixed(2)})`,
            score: entry.score,
          });
        }
      }
    }

    // Promote explicit "remember" requests
    for (const entry of entries) {
      if (/\b(remember|merke dir|speicher|note that|vergiss nicht)\b/i.test(entry.content)) {
        candidates.push({
          fragment: entry,
          reason: 'User explicitly asked to remember',
          score: entry.score + 0.5,
        });
      }
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  /**
   * Auto-summarization pipeline: summarize daily logs into weekly summaries.
   */
  async summarizePeriod(
    fragments: MemoryFragment[],
    periodLabel: string
  ): Promise<MemoryFragment> {
    const sorted = [...fragments].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const contents = sorted.map(f => f.content);
    const summary = await this.summarizeFn(contents);

    return {
      content: `[${periodLabel} Summary] ${summary}`,
      source: `summary:${periodLabel}`,
      timestamp: sorted[sorted.length - 1]?.timestamp ?? new Date().toISOString(),
      score: Math.max(...sorted.map(f => f.score), 0),
      tokens: this.estimateTokens(summary),
    };
  }

  /**
   * Get the consolidation changelog.
   */
  getChangelog(): ChangeLogEntry[] {
    return [...this.changelog];
  }

  // ─── Private Methods ────────────────────────────────────────────────────────

  private groupByTopic(entries: MemoryFragment[]): MemoryFragment[][] {
    if (!this.graph) return [entries];

    const entityGroups = new Map<string, MemoryFragment[]>();
    const ungrouped: MemoryFragment[] = [];

    for (const entry of entries) {
      const entities = this.graph.findEntities(entry.content);
      if (entities.length > 0) {
        const primaryEntity = entities[0]!.id;
        const existing = entityGroups.get(primaryEntity) ?? [];
        existing.push(entry);
        entityGroups.set(primaryEntity, existing);
      } else {
        ungrouped.push(entry);
      }
    }

    const groups = Array.from(entityGroups.values());
    if (ungrouped.length > 0) groups.push(ungrouped);
    return groups;
  }

  private groupBySimilarity(entries: MemoryFragment[], threshold: number): MemoryFragment[][] {
    const used = new Set<number>();
    const groups: MemoryFragment[][] = [];

    for (let i = 0; i < entries.length; i++) {
      if (used.has(i)) continue;

      const group: MemoryFragment[] = [entries[i]!];
      used.add(i);

      for (let j = i + 1; j < entries.length; j++) {
        if (used.has(j)) continue;

        if (this.textSimilarity(entries[i]!.content, entries[j]!.content) > threshold) {
          group.push(entries[j]!);
          used.add(j);
        }
      }

      groups.push(group);
    }

    return groups;
  }

  private textSimilarity(a: string, b: string): number {
    const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(t => t.length > 2));
    const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(t => t.length > 2));

    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    let intersection = 0;
    for (const t of tokensA) {
      if (tokensB.has(t)) intersection++;
    }

    return intersection / (tokensA.size + tokensB.size - intersection);
  }

  private findContradiction(a: string, b: string): string | null {
    const la = a.toLowerCase();
    const lb = b.toLowerCase();

    const negationPairs: Array<[RegExp, RegExp]> = [
      [/(\w+) is (\w+)/, /(\w+) is not (\w+)/],
      [/(\w+) can (\w+)/, /(\w+) cannot (\w+)/],
      [/(\w+) should (\w+)/, /(\w+) should not (\w+)/],
      [/(\w+) likes (\w+)/, /(\w+) (dislikes|hates) (\w+)/],
      [/(\w+) supports (\w+)/, /(\w+) opposes (\w+)/],
      [/(\w+) works at (\w+)/, /(\w+) left (\w+)/],
      [/(\w+) uses (\w+)/, /(\w+) stopped using (\w+)/],
      [/(\w+) lives in (\w+)/, /(\w+) moved from (\w+)/],
    ];

    for (const [positive, negative] of negationPairs) {
      const matchA = la.match(positive);
      const matchB = lb.match(negative);
      if (matchA && matchB && matchA[1] === matchB[1]) {
        return `Contradicting information about "${matchA[1]}"`;
      }

      const matchA2 = la.match(negative);
      const matchB2 = lb.match(positive);
      if (matchA2 && matchB2 && matchA2[1] === matchB2[1]) {
        return `Contradicting information about "${matchA2[1]}"`;
      }
    }

    return null;
  }

  private contentFingerprint(content: string): string {
    return content
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3)
      .sort()
      .slice(0, 10)
      .join('|');
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
