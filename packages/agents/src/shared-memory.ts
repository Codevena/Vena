interface SharedEntry {
  value: unknown;
  fromAgentId: string;
  timestamp: string;
}

export class SharedMemoryManager {
  private store = new Map<string, SharedEntry>();
  private accessRules = new Map<string, Set<string>>();

  constructor(private namespace: string) {}

  share(key: string, value: unknown, fromAgentId: string): void {
    const namespacedKey = `${this.namespace}:${key}`;
    this.store.set(namespacedKey, {
      value,
      fromAgentId,
      timestamp: new Date().toISOString(),
    });
  }

  get(key: string): SharedEntry | undefined {
    return this.store.get(`${this.namespace}:${key}`);
  }

  getAll(): Map<string, SharedEntry> {
    const result = new Map<string, SharedEntry>();
    const prefix = `${this.namespace}:`;
    for (const [key, entry] of this.store) {
      if (key.startsWith(prefix)) {
        result.set(key.slice(prefix.length), entry);
      }
    }
    return result;
  }

  search(query: string): Array<{ key: string } & SharedEntry> {
    const results: Array<{ key: string } & SharedEntry> = [];
    const lowerQuery = query.toLowerCase();
    const prefix = `${this.namespace}:`;

    for (const [key, entry] of this.store) {
      if (!key.startsWith(prefix)) continue;
      const shortKey = key.slice(prefix.length);

      const matchesKey = shortKey.toLowerCase().includes(lowerQuery);
      const matchesValue =
        typeof entry.value === 'string' &&
        entry.value.toLowerCase().includes(lowerQuery);

      if (matchesKey || matchesValue) {
        results.push({ key: shortKey, ...entry });
      }
    }

    return results;
  }

  isAccessible(agentId: string, key: string): boolean {
    const namespacedKey = `${this.namespace}:${key}`;
    const rules = this.accessRules.get(namespacedKey);

    // If no rules are set, the key is accessible to all
    if (!rules) return true;

    return rules.has(agentId);
  }

  setAccessRule(key: string, allowedAgentIds: string[]): void {
    const namespacedKey = `${this.namespace}:${key}`;
    this.accessRules.set(namespacedKey, new Set(allowedAgentIds));
  }
}
