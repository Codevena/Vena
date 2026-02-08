import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

type OAuthCodeState =
  | { code: string; state: string }
  | { error: string };

export function isRemoteEnvironment(): boolean {
  return Boolean(
    process.env.SSH_CONNECTION ||
    process.env.SSH_TTY ||
    process.env.CI ||
    process.env.CODESPACES ||
    process.env.REMOTE_CONTAINERS,
  );
}

function isWSL(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    const release = readFileSync('/proc/version', 'utf8').toLowerCase();
    return release.includes('microsoft') || release.includes('wsl');
  } catch {
    return false;
  }
}

function isWSL2(): boolean {
  if (!isWSL()) return false;
  try {
    const release = readFileSync('/proc/version', 'utf8').toLowerCase();
    return release.includes('wsl2') || release.includes('microsoft-standard');
  } catch {
    return false;
  }
}

export function shouldUseManualOAuthFlow(): boolean {
  return isRemoteEnvironment() || isWSL2();
}

export function openBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let command = '';
    let args: string[] = [];

    if (process.platform === 'darwin') {
      command = 'open';
      args = [url];
    } else if (process.platform === 'win32') {
      command = 'cmd';
      args = ['/c', 'start', '""', url];
    } else {
      command = 'xdg-open';
      args = [url];
    }

    try {
      const child = spawn(command, args, { stdio: 'ignore', detached: true });
      child.on('error', (err) => reject(err));
      child.unref();
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

export function extractOAuthCode(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  if (trimmed.includes('://')) {
    try {
      const url = new URL(trimmed);
      const code = url.searchParams.get('code');
      if (code) return code;
    } catch {
      // fall through
    }
  }

  const match = /(?:^|[?&])code=([^&]+)/.exec(trimmed);
  if (match && match[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  return trimmed;
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function extractOAuthCodeAndState(input: string, expectedState: string): OAuthCodeState {
  const trimmed = input.trim();
  if (!trimmed) return { error: 'No input provided.' };

  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state') ?? expectedState;
    if (!code) return { error: "Missing 'code' parameter in URL." };
    if (!state) return { error: "Missing 'state' parameter. Paste the full URL." };
    return { code, state };
  } catch {
    if (!expectedState) {
      return { error: 'Paste the full redirect URL, not just the code.' };
    }
    return { code: trimmed, state: expectedState };
  }
}

export function canUseLocalCallback(redirectUri: string): boolean {
  try {
    const url = new URL(redirectUri);
    if (url.protocol !== 'http:') return false;
    const host = url.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

export async function waitForOAuthCallback(params: {
  redirectUri: string;
  expectedState?: string;
  timeoutMs: number;
  onProgress?: (message: string) => void;
}): Promise<{ code: string; state?: string }> {
  const redirectUrl = new URL(params.redirectUri);
  if (redirectUrl.protocol !== 'http:') {
    throw new Error('Local callback requires http:// redirect URI.');
  }

  const hostname = redirectUrl.hostname || 'localhost';
  const port = redirectUrl.port
    ? Number(redirectUrl.port)
    : (redirectUrl.protocol === 'https:' ? 443 : 80);
  const expectedPath = redirectUrl.pathname || '/';

  return await new Promise<{ code: string; state?: string }>((resolve, reject) => {
    let timeout: NodeJS.Timeout | null = null;
    const server = createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url ?? '/', `http://${hostname}:${port}`);
        if (requestUrl.pathname !== expectedPath) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain');
          res.end('Not found');
          return;
        }

        const error = requestUrl.searchParams.get('error');
        const code = requestUrl.searchParams.get('code')?.trim();
        const state = requestUrl.searchParams.get('state')?.trim();

        if (error) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/plain');
          res.end(`Authentication failed: ${error}`);
          finish(new Error(`OAuth error: ${error}`));
          return;
        }

        if (!code) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/plain');
          res.end('Missing code');
          finish(new Error('Missing OAuth code'));
          return;
        }

        if (params.expectedState && state !== params.expectedState) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/plain');
          res.end('Invalid state');
          finish(new Error('OAuth state mismatch'));
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(
          '<!doctype html><html><head><meta charset="utf-8"/></head>' +
            '<body><h2>OAuth complete</h2><p>You can close this window and return to Vena.</p></body></html>',
        );

        finish(undefined, { code, state: state ?? undefined });
      } catch (err) {
        finish(err instanceof Error ? err : new Error('OAuth callback failed'));
      }
    });

    const finish = (err?: Error, result?: { code: string; state?: string }) => {
      if (timeout) clearTimeout(timeout);
      try {
        server.close();
      } catch {
        // ignore
      }
      if (err) {
        reject(err);
      } else if (result) {
        resolve(result);
      }
    };

    server.once('error', (err) => {
      finish(err instanceof Error ? err : new Error('OAuth callback server error'));
    });

    server.listen(port, hostname, () => {
      params.onProgress?.(`Waiting for OAuth callback on ${params.redirectUri}…`);
    });

    timeout = setTimeout(() => {
      finish(new Error('OAuth callback timeout'));
    }, params.timeoutMs);
  });
}

export function findInPath(name: string): string | null {
  const exts = process.platform === 'win32' ? ['.cmd', '.bat', '.exe', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    for (const ext of exts) {
      const p = join(dir, name + ext);
      if (existsSync(p)) {
        return p;
      }
    }
  }
  return null;
}

export function resolveExecutableRoot(executablePath: string): string | null {
  try {
    const real = realpathSync.native(executablePath);
    return dirname(dirname(real));
  } catch {
    return null;
  }
}
