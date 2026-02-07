import Database from 'better-sqlite3';

interface DocRow {
  id: string;
  content: string;
}

interface TokenRow {
  doc_id: string;
  token: string;
  tf: number;
}

export class VectorSearch {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tokens (
        doc_id TEXT NOT NULL,
        token TEXT NOT NULL,
        tf REAL NOT NULL,
        PRIMARY KEY (doc_id, token),
        FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_tokens_token ON tokens(token);
    `);
  }

  index(id: string, content: string, _embedding?: number[]): void {
    const tokens = this.tokenize(content);
    const tokenCounts = new Map<string, number>();

    for (const token of tokens) {
      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
    }

    const totalTokens = tokens.length || 1;

    this.db.transaction(() => {
      this.db.prepare('INSERT OR REPLACE INTO documents (id, content) VALUES (?, ?)').run(
        id,
        content,
      );

      // Clear old tokens for this doc
      this.db.prepare('DELETE FROM tokens WHERE doc_id = ?').run(id);

      const insertToken = this.db.prepare(
        'INSERT INTO tokens (doc_id, token, tf) VALUES (?, ?, ?)',
      );

      for (const [token, count] of tokenCounts) {
        const tf = count / totalTokens;
        insertToken.run(id, token, tf);
      }
    })();
  }

  search(query: string, options?: { limit?: number }): { id: string; content: string; score: number }[] {
    const limit = options?.limit ?? 10;
    const queryTokens = this.tokenize(query);

    if (queryTokens.length === 0) return [];

    // Get total document count for IDF
    const totalDocs = (
      this.db.prepare('SELECT COUNT(*) as count FROM documents').get() as { count: number }
    ).count;

    if (totalDocs === 0) return [];

    // Calculate BM25-like scores
    const k1 = 1.2;
    const b = 0.75;

    // Get average document length
    const avgDl = (
      this.db
        .prepare(
          'SELECT AVG(total_tf) as avg_dl FROM (SELECT SUM(tf) as total_tf FROM tokens GROUP BY doc_id)',
        )
        .get() as { avg_dl: number } | undefined
    )?.avg_dl ?? 1;

    const scores = new Map<string, number>();

    for (const token of queryTokens) {
      // Number of documents containing this token (for IDF)
      const df = (
        this.db
          .prepare('SELECT COUNT(DISTINCT doc_id) as df FROM tokens WHERE token = ?')
          .get(token) as { df: number }
      ).df;

      if (df === 0) continue;

      const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);

      // Get TF for all docs containing this token
      const rows = this.db
        .prepare('SELECT doc_id, tf FROM tokens WHERE token = ?')
        .all(token) as TokenRow[];

      for (const row of rows) {
        const tf = row.tf;
        const score = idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (tf / avgDl))));
        scores.set(row.doc_id, (scores.get(row.doc_id) ?? 0) + score);
      }
    }

    // Sort by score and fetch content
    const sorted = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    return sorted.map(([id, score]) => {
      const row = this.db.prepare('SELECT content FROM documents WHERE id = ?').get(id) as
        | { content: string }
        | undefined;
      return { id, content: row?.content ?? '', score };
    });
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  close(): void {
    this.db.close();
  }
}
