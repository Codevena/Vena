export class UrlValidator {
  constructor(private allowPrivateIPs: boolean = false) {}

  validate(url: string): { allowed: boolean; reason?: string } {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { allowed: false, reason: `Invalid URL: ${url}` };
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return {
        allowed: false,
        reason: `Protocol '${parsed.protocol}' is not allowed. Only http: and https: are permitted.`,
      };
    }

    if (!this.allowPrivateIPs) {
      const hostname = parsed.hostname;
      if (this.isPrivateIP(hostname)) {
        return { allowed: false, reason: `Access to private/internal IP '${hostname}' is blocked` };
      }
    }

    return { allowed: true };
  }

  private isPrivateIP(hostname: string): boolean {
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return true;
    }

    const parts = hostname.split('.');
    if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
      const [a, b, c, d] = parts.map(Number) as [number, number, number, number];
      if (a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 169 && b === 254) return true;
      if (a === 0 && b === 0 && c === 0 && d === 0) return true;
    }

    if (hostname.startsWith('[')) {
      const ipv6 = hostname.slice(1, -1);
      if (
        ipv6 === '::1' ||
        ipv6.startsWith('fe80:') ||
        ipv6.startsWith('fc00:') ||
        ipv6.startsWith('fd')
      ) {
        return true;
      }
    }

    return false;
  }
}
