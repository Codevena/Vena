import { spawn } from 'node:child_process';

export interface DockerSandboxConfig {
  /** Docker image to use (default: node:22-slim) */
  image?: string;
  /** Memory limit (e.g., "512m", "1g") */
  memoryLimit?: string;
  /** CPU quota (e.g., "1.0" = 1 CPU) */
  cpuLimit?: string;
  /** Network mode: "none" (isolated), "host", or custom network name */
  network?: string;
  /** Additional volume mounts as host:container pairs */
  extraMounts?: string[];
  /** Read-only root filesystem */
  readOnlyRoot?: boolean;
}

const DEFAULT_IMAGE = 'node:22-slim';
const DEFAULT_MEMORY = '512m';
const DEFAULT_CPU = '1.0';
const DEFAULT_NETWORK = 'none';

/**
 * Execute a shell command inside a Docker container with resource limits.
 * The workspace directory is mounted as /workspace.
 */
export async function runInDocker(
  command: string,
  workspacePath: string,
  config: DockerSandboxConfig = {},
  options: { timeout?: number; envPassthrough?: string[] } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number | null; truncated: boolean }> {
  const image = config.image ?? DEFAULT_IMAGE;
  const timeout = options.timeout ?? 30000;
  const maxBytes = 1024 * 1024; // 1MB

  const args: string[] = [
    'run',
    '--rm',
    '-i',
    '--memory', config.memoryLimit ?? DEFAULT_MEMORY,
    '--cpus', config.cpuLimit ?? DEFAULT_CPU,
    '--network', config.network ?? DEFAULT_NETWORK,
    '-w', '/workspace',
    '-v', `${workspacePath}:/workspace`,
  ];

  // Read-only root filesystem
  if (config.readOnlyRoot !== false) {
    args.push('--read-only');
    args.push('--tmpfs', '/tmp:rw,noexec,nosuid,size=100m');
  }

  // Extra volume mounts
  if (config.extraMounts) {
    for (const mount of config.extraMounts) {
      args.push('-v', mount);
    }
  }

  // Pass through environment variables
  if (options.envPassthrough) {
    for (const key of options.envPassthrough) {
      if (process.env[key] !== undefined) {
        args.push('-e', `${key}=${process.env[key]}`);
      }
    }
  }

  // Security: drop all capabilities, no new privileges
  args.push('--cap-drop=ALL');
  args.push('--security-opt', 'no-new-privileges');

  args.push(image, 'bash', '-c', command);

  return new Promise((resolve) => {
    const proc = spawn('docker', args, { timeout });

    let stdout = '';
    let stderr = '';
    let totalBytes = 0;
    let truncated = false;

    proc.stdout.on('data', (data: Buffer) => {
      totalBytes += data.length;
      if (totalBytes <= maxBytes) {
        stdout += data.toString();
      } else if (!truncated) {
        truncated = true;
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      totalBytes += data.length;
      if (totalBytes <= maxBytes) {
        stderr += data.toString();
      } else if (!truncated) {
        truncated = true;
      }
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code, truncated });
    });

    proc.on('error', (err) => {
      resolve({
        stdout: '',
        stderr: `Docker execution failed: ${err.message}`,
        exitCode: 1,
        truncated: false,
      });
    });
  });
}

/** Check if Docker is available on the system */
export function isDockerAvailable(): boolean {
  try {
    const proc = spawn('docker', ['info'], { stdio: 'ignore', timeout: 5000 });
    return new Promise<boolean>((resolve) => {
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    }) as unknown as boolean;
  } catch {
    return false;
  }
}

/** Async check for Docker availability */
export async function checkDockerAvailable(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const proc = spawn('docker', ['info'], { stdio: 'ignore', timeout: 5000 });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}
