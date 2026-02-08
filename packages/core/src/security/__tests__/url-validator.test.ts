import { describe, it, expect } from 'vitest';
import { UrlValidator } from '../url-validator.js';

describe('UrlValidator', () => {
  const validator = new UrlValidator(false);

  it('allows valid https URLs', () => {
    expect(validator.validate('https://example.com')).toEqual({ allowed: true });
    expect(validator.validate('https://api.github.com/repos')).toEqual({ allowed: true });
  });

  it('allows valid http URLs', () => {
    expect(validator.validate('http://example.com')).toEqual({ allowed: true });
  });

  it('blocks file:// protocol', () => {
    const result = validator.validate('file:///etc/passwd');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('file:');
  });

  it('blocks ftp:// protocol', () => {
    const result = validator.validate('ftp://files.example.com');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('ftp:');
  });

  it('blocks data: URLs', () => {
    const result = validator.validate('data:text/html,<script>alert(1)</script>');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('data:');
  });

  it('blocks localhost (127.0.0.1)', () => {
    const result = validator.validate('http://127.0.0.1:8080');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('127.0.0.1');
  });

  it('blocks 10.x.x.x private range', () => {
    const result = validator.validate('http://10.0.0.1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('10.0.0.1');
  });

  it('blocks 172.16-31.x private range', () => {
    const result = validator.validate('http://172.16.0.1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('172.16.0.1');

    const result2 = validator.validate('http://172.31.255.255');
    expect(result2.allowed).toBe(false);
  });

  it('blocks 192.168.x.x private range', () => {
    const result = validator.validate('http://192.168.1.1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('192.168.1.1');
  });

  it('blocks 169.254.x.x link-local', () => {
    const result = validator.validate('http://169.254.169.254');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('169.254.169.254');
  });

  it('blocks ::1 (IPv6 localhost)', () => {
    const result = validator.validate('http://[::1]:3000');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('::1');
  });

  it('allows private IPs when allowPrivateIPs is true', () => {
    const permissive = new UrlValidator(true);
    expect(permissive.validate('http://127.0.0.1:8080')).toEqual({ allowed: true });
    expect(permissive.validate('http://192.168.1.1')).toEqual({ allowed: true });
    expect(permissive.validate('http://10.0.0.1')).toEqual({ allowed: true });
  });

  it('rejects invalid URLs', () => {
    const result = validator.validate('not-a-url');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Invalid URL');
  });
});
