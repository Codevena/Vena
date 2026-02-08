import { describe, it, expect } from 'vitest';
import { PathValidator } from '../path-validator.js';

describe('PathValidator', () => {
  it('allows paths within allowed roots', () => {
    const validator = new PathValidator(['/workspace'], []);
    const result = validator.validate('/workspace/src/index.ts');
    expect(result.allowed).toBe(true);
  });

  it('blocks paths outside allowed roots', () => {
    const validator = new PathValidator(['/workspace'], []);
    const result = validator.validate('/etc/passwd');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('outside allowed workspace');
  });

  it('blocks paths with ../ traversal', () => {
    const validator = new PathValidator(['/workspace'], []);
    const result = validator.validate('/workspace/../etc/passwd');
    expect(result.allowed).toBe(false);
  });

  it('blocks .env files', () => {
    const validator = new PathValidator([], ['.env']);
    const result = validator.validate('/workspace/.env');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('.env');
  });

  it('blocks .ssh directory', () => {
    const validator = new PathValidator([], ['.ssh']);
    const result = validator.validate('/home/user/.ssh/id_rsa');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('.ssh');
  });

  it('blocks .aws directory', () => {
    const validator = new PathValidator([], ['.aws']);
    const result = validator.validate('/home/user/.aws/credentials');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('.aws');
  });

  it('blocks .git/config', () => {
    const validator = new PathValidator([], ['.git/config']);
    const result = validator.validate('/workspace/.git/config');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('.git/config');
  });

  it('allows valid paths when no roots configured (empty allowedRoots)', () => {
    const validator = new PathValidator([], []);
    const result = validator.validate('/any/path/file.txt');
    expect(result.allowed).toBe(true);
  });

  it('handles non-existent files gracefully', () => {
    const validator = new PathValidator(['/workspace'], []);
    // Non-existent file within allowed root — resolve() will be used as fallback
    const result = validator.validate('/workspace/nonexistent/deep/file.ts');
    expect(result.allowed).toBe(true);
  });
});
