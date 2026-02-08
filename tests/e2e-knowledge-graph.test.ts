/**
 * E2E Tests: Knowledge Graph (SQLite)
 *
 * Tests actual SQLite operations — entity CRUD, relationships,
 * graph traversal. No API keys needed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { KnowledgeGraph } from '@vena/semantic-memory';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let graph: KnowledgeGraph;
let dbPath: string;

describe('KnowledgeGraph E2E', () => {
  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vena-kg-test-'));
    dbPath = path.join(tmpDir, 'test-knowledge.db');
    graph = new KnowledgeGraph(dbPath);
  });

  afterAll(() => {
    graph.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true });
    } catch { /* ignore cleanup errors */ }
  });

  // ── Entity CRUD ────────────────────────────────────────────────
  it('creates entities and retrieves them', () => {
    const entity = graph.addEntity({
      name: 'Markus',
      type: 'person',
      confidence: 0.9,
      source: 'test',
      attributes: {},
      mentions: 1,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    });

    expect(entity).toBeDefined();
    expect(entity.id).toBeTruthy();
    const found = graph.getEntity(entity.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Markus');
    expect(found!.type).toBe('person');
  });

  it('finds entities by name', () => {
    graph.addEntity({
      name: 'TypeScript',
      type: 'technology',
      confidence: 0.95,
      source: 'test',
      attributes: {},
      mentions: 1,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    });

    const results = graph.findEntities('TypeScript');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(e => e.name === 'TypeScript')).toBe(true);
  });

  it('updates entity fields', () => {
    const entity = graph.addEntity({
      name: 'Vena',
      type: 'project',
      confidence: 0.8,
      source: 'test',
      attributes: {},
      mentions: 1,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    });

    graph.updateEntity(entity.id, { confidence: 0.99 });
    const updated = graph.getEntity(entity.id);
    expect(updated!.confidence).toBe(0.99);
  });

  // ── Relationships ──────────────────────────────────────────────
  it('creates relationships between entities', () => {
    const person = graph.addEntity({
      name: 'Alice',
      type: 'person',
      confidence: 0.9,
      source: 'test',
      attributes: {},
      mentions: 1,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    });

    const project = graph.addEntity({
      name: 'ProjectX',
      type: 'project',
      confidence: 0.85,
      source: 'test',
      attributes: {},
      mentions: 1,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    });

    const rel = graph.addRelationship({
      sourceId: person.id,
      targetId: project.id,
      type: 'works_on',
      weight: 0.9,
      source: 'test',
    });

    expect(rel).toBeDefined();
    const found = graph.getRelationshipBetween(person.id, project.id);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].type).toBe('works_on');
  });

  // ── Graph Traversal ────────────────────────────────────────────
  it('finds connected entities via BFS', () => {
    const now = new Date().toISOString();
    const a = graph.addEntity({ name: 'NodeA', type: 'concept', confidence: 1, source: 'test', attributes: {}, mentions: 1, firstSeen: now, lastSeen: now });
    const b = graph.addEntity({ name: 'NodeB', type: 'concept', confidence: 1, source: 'test', attributes: {}, mentions: 1, firstSeen: now, lastSeen: now });
    const c = graph.addEntity({ name: 'NodeC', type: 'concept', confidence: 1, source: 'test', attributes: {}, mentions: 1, firstSeen: now, lastSeen: now });

    graph.addRelationship({ sourceId: a.id, targetId: b.id, type: 'related', weight: 1, source: 'test' });
    graph.addRelationship({ sourceId: b.id, targetId: c.id, type: 'related', weight: 1, source: 'test' });

    const connected = graph.getConnectedEntities(a.id, 2);
    const names = connected.map(e => e.name);
    expect(names).toContain('NodeB');
    expect(names).toContain('NodeC');
  });

  it('finds shortest path between entities', () => {
    const now = new Date().toISOString();
    const x = graph.addEntity({ name: 'PathStart', type: 'concept', confidence: 1, source: 'test', attributes: {}, mentions: 1, firstSeen: now, lastSeen: now });
    const y = graph.addEntity({ name: 'PathMid', type: 'concept', confidence: 1, source: 'test', attributes: {}, mentions: 1, firstSeen: now, lastSeen: now });
    const z = graph.addEntity({ name: 'PathEnd', type: 'concept', confidence: 1, source: 'test', attributes: {}, mentions: 1, firstSeen: now, lastSeen: now });

    graph.addRelationship({ sourceId: x.id, targetId: y.id, type: 'links', weight: 1, source: 'test' });
    graph.addRelationship({ sourceId: y.id, targetId: z.id, type: 'links', weight: 1, source: 'test' });

    const pathResult = graph.shortestPath(x.id, z.id);
    expect(pathResult).toBeDefined();
    expect(pathResult!.length).toBe(3); // x -> y -> z
  });

  // ── Stats ──────────────────────────────────────────────────────
  it('returns graph statistics', () => {
    const stats = graph.getStats();
    expect(stats.totalEntities).toBeGreaterThan(0);
    expect(typeof stats.totalRelationships).toBe('number');
  });
});
