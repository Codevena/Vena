import { resolve, normalize } from 'node:path';
import { realpathSync } from 'node:fs';

export class PathValidator {
  constructor(
    private allowedRoots: string[],
    private blockedPatterns: string[],
  ) {}

  validate(filePath: string): { allowed: boolean; reason?: string } {
    const normalized = normalize(filePath);

    if (filePath.includes('..')) {
      const resolved = resolve(filePath);
      if (normalized !== resolved) {
        return { allowed: false, reason: `Path traversal detected: ${filePath}` };
      }
    }

    let realPath: string;
    try {
      realPath = realpathSync(filePath);
    } catch {
      realPath = resolve(filePath);
    }

    for (const pattern of this.blockedPatterns) {
      if (realPath.includes(pattern) || normalized.includes(pattern)) {
        return { allowed: false, reason: `Access to '${pattern}' is blocked by security policy` };
      }
    }

    if (this.allowedRoots.length > 0) {
      const inAllowedRoot = this.allowedRoots.some((root) => {
        const resolvedRoot = resolve(root);
        return realPath.startsWith(resolvedRoot + '/') || realPath === resolvedRoot;
      });
      if (!inAllowedRoot) {
        return { allowed: false, reason: `Path '${filePath}' is outside allowed workspace` };
      }
    }

    return { allowed: true };
  }
}
