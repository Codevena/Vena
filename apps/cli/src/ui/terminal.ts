import chalk from 'chalk';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { highlight } from 'cli-highlight';

// ── Color Palette ──────────────────────────────────────────────────────
export const colors = {
  primary: chalk.hex('#FF6B2B'),       // Vena Orange
  secondary: chalk.hex('#FF9F1C'),     // Warm Gold
  accent: chalk.hex('#FF4500'),        // Deep Orange
  success: chalk.hex('#2ECC71'),       // Green
  dim: chalk.hex('#666666'),           // Muted gray
  white: chalk.hex('#FFFFFF'),         // White
  bgPrimary: chalk.bgHex('#FF6B2B'),  // Background orange
  error: chalk.hex('#E74C3C'),         // Red
};

// Gradient shades from deep orange to warm gold (for the logo lines)
const GRADIENT = [
  chalk.hex('#FF4500'),
  chalk.hex('#FF5511'),
  chalk.hex('#FF6B2B'),
  chalk.hex('#FF7B3A'),
  chalk.hex('#FF8C42'),
  chalk.hex('#FF9F1C'),
];

const LOGO_LINES = [
  '██╗   ██╗███████╗███╗   ██╗ █████╗ ',
  '██║   ██║██╔════╝████╗  ██║██╔══██╗',
  '██║   ██║█████╗  ██╔██╗ ██║███████║',
  '╚██╗ ██╔╝██╔══╝  ██║╚██╗██║██╔══██║',
  ' ╚████╔╝ ███████╗██║ ╚████║██║  ██║',
  '  ╚═══╝  ╚══════╝╚═╝  ╚═══╝╚═╝  ╚═╝',
];

// ── Utilities ──────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function clearScreen(): void {
  process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
}

export function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

function centerPad(text: string, width: number): string {
  const stripped = stripAnsi(text);
  const pad = Math.max(0, Math.floor((width - stripped.length) / 2));
  return ' '.repeat(pad) + text;
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

// ── Logo ───────────────────────────────────────────────────────────────

export function renderLogo(): string[] {
  return LOGO_LINES.map((line, i) => {
    const color = GRADIENT[i] ?? GRADIENT[GRADIENT.length - 1]!;
    return color(line);
  });
}

export async function printLogo(animated = true): Promise<void> {
  const width = getTerminalWidth();
  const logoLines = renderLogo();

  for (const line of logoLines) {
    process.stdout.write(centerPad(line, width) + '\n');
    if (animated) {
      await sleep(60);
    }
  }
}

// ── Progress Bar ───────────────────────────────────────────────────────

export function progressBar(current: number, total: number, width = 30): string {
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  const bar = colors.primary('█'.repeat(filled)) + colors.dim('░'.repeat(empty));
  return bar;
}

// ── Box Drawing ────────────────────────────────────────────────────────

export interface BoxOptions {
  title?: string;
  padding?: number;
  borderColor?: (text: string) => string;
  width?: number;
}

export function boxed(lines: string[], options: BoxOptions = {}): string {
  const {
    title,
    padding = 1,
    borderColor = colors.primary,
    width: forceWidth,
  } = options;

  const pad = ' '.repeat(padding);

  // Calculate width from content
  const contentWidths = lines.map(l => stripAnsi(l).length + padding * 2);
  const titleWidth = title ? stripAnsi(title).length + 4 : 0;
  const maxContent = Math.max(...contentWidths, titleWidth);
  const boxWidth = forceWidth ?? Math.min(maxContent, getTerminalWidth() - 4);

  const top = title
    ? borderColor('┌─ ') + colors.secondary(title) + ' ' + borderColor('─'.repeat(Math.max(0, boxWidth - stripAnsi(title).length - 4)) + '┐')
    : borderColor('┌' + '─'.repeat(boxWidth) + '┐');
  const bottom = borderColor('└' + '─'.repeat(boxWidth) + '┘');

  const rows = lines.map(line => {
    const stripped = stripAnsi(line);
    const rightPad = Math.max(0, boxWidth - stripped.length - padding * 2);
    return borderColor('│') + pad + line + ' '.repeat(rightPad) + pad.slice(0, Math.max(0, padding)) + borderColor('│');
  });

  // Fix: ensure each row has correct width by recalculating
  const fixedRows = lines.map(line => {
    const stripped = stripAnsi(line);
    const innerSpace = boxWidth - padding * 2;
    const rightPad = Math.max(0, innerSpace - stripped.length);
    return borderColor('│') + pad + line + ' '.repeat(rightPad) + pad + borderColor('│');
  });

  return [top, ...fixedRows, bottom].join('\n');
}

// ── Typewriter ─────────────────────────────────────────────────────────

export async function typewriter(text: string, delay = 25): Promise<void> {
  for (const char of text) {
    process.stdout.write(char);
    await sleep(delay);
  }
  process.stdout.write('\n');
}

// ── Spinner Line ───────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export async function spinnerLine(text: string, durationMs = 600): Promise<void> {
  const start = Date.now();
  let i = 0;

  while (Date.now() - start < durationMs) {
    const frame = SPINNER_FRAMES[i % SPINNER_FRAMES.length]!;
    process.stdout.write(`\r  ${colors.primary(frame)} ${text}`);
    i++;
    await sleep(80);
  }

  process.stdout.write(`\r  ${colors.success('✓')} ${text}\n`);
}

// ── Divider ────────────────────────────────────────────────────────────

export function divider(char = '━', width?: number): string {
  const w = width ?? Math.min(getTerminalWidth() - 4, 60);
  return colors.primary(char.repeat(w));
}

// ── Badge ──────────────────────────────────────────────────────────────

export function badge(text: string): string {
  return colors.bgPrimary(chalk.bold.white(` ${text} `));
}

// ── Step Indicator ─────────────────────────────────────────────────────

export function stepIndicator(current: number, total: number): string {
  return colors.primary('●') + colors.dim(` Step ${current} of ${total}`);
}

// ── Section Header ─────────────────────────────────────────────────────

export function sectionHeader(title: string): string {
  return colors.primary('▸ ') + chalk.bold(title);
}

// ── Key-Value Line ─────────────────────────────────────────────────────

export function kvLine(key: string, value: string, keyWidth = 20): string {
  const paddedKey = key.padEnd(keyWidth);
  return colors.dim(paddedKey) + colors.white(value);
}

// ── Markdown Rendering ────────────────────────────────────────────────

// Configure marked with terminal renderer once
marked.use(
  markedTerminal({
    code: (code: string, lang?: string) => {
      try {
        return highlight(code, { language: lang || 'auto', ignoreIllegals: true });
      } catch {
        return code;
      }
    },
    codespan: (text: string) => colors.secondary(text),
    heading: (text: string) => '\n' + colors.primary(chalk.bold(text)) + '\n',
    strong: (text: string) => chalk.bold(text),
    em: (text: string) => chalk.italic(text),
    listitem: (text: string) => '  ' + colors.primary('•') + ' ' + text,
    blockquote: (text: string) => colors.dim('  │ ') + colors.dim(text),
    link: (href: string, _title: string | null, text: string) =>
      colors.secondary(text) + colors.dim(` (${href})`),
    hr: () => colors.dim('─'.repeat(40)),
    paragraph: (text: string) => text + '\n',
    tab: 2,
  }) as any,
);

export function renderMarkdown(text: string): string {
  try {
    const result = marked.parse(text);
    if (typeof result === 'string') {
      return result.replace(/\n$/, '');
    }
    return text;
  } catch {
    return text;
  }
}

// ── Tool Call/Result Rendering ────────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  bash: '$',
  read: 'R',
  write: 'W',
  edit: 'E',
  web_browse: 'G',
  browser: 'B',
  google: 'G',
  consult_agent: 'C',
  delegate_task: 'D',
};

function getToolArg(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'bash':
      return String(args['command'] ?? '').slice(0, 60);
    case 'read':
    case 'write':
    case 'edit':
      return String(args['path'] ?? '').replace(/^.*\//, '');
    case 'web_browse':
      return String(args['url'] ?? '').slice(0, 60);
    case 'browser':
      return String(args['action'] ?? '');
    case 'google':
      return String(args['action'] ?? args['resource'] ?? '');
    case 'consult_agent':
    case 'delegate_task':
      return String(args['agentId'] ?? args['agent_id'] ?? '');
    default:
      return '';
  }
}

export function renderToolCall(toolName: string, args: Record<string, unknown>): string {
  const icon = TOOL_ICONS[toolName] ?? '?';
  const arg = getToolArg(toolName, args);
  return `  ${colors.dim('[')}${colors.secondary(icon)}${colors.dim(']')} ${colors.white(toolName)} ${colors.dim(arg)}`;
}

export function renderToolResult(result: { content: string; isError?: boolean }, toolName: string): string {
  if (result.isError) {
    const errMsg = result.content.split('\n')[0]?.slice(0, 80) ?? 'Unknown error';
    return `  ${colors.error('✗')} ${colors.white(toolName)} ${colors.error(errMsg)}`;
  }

  const lines = result.content.split('\n');
  const maxLines = 6;
  const maxChars = 80;

  const preview = lines
    .slice(0, maxLines)
    .map(l => (l.length > maxChars ? l.slice(0, maxChars) + '...' : l))
    .map(l => `  ${colors.dim(l)}`)
    .join('\n');

  const more = lines.length > maxLines ? `\n  ${colors.dim(`... ${lines.length - maxLines} more lines`)}` : '';

  return `  ${colors.success('✓')} ${colors.white(toolName)}${preview ? '\n' + preview : ''}${more}`;
}

// ── Elapsed Time ──────────────────────────────────────────────────────

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
