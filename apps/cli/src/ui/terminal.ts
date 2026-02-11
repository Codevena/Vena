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

// ── Thinking Indicator ───────────────────────────────────────────────

const THINKING_SYMBOL = '\u27E1'; // ⟡

export function createThinkingIndicator(): {
  start(): void;
  update(preview?: string): void;
  stop(): string;
} {
  let timer: ReturnType<typeof setInterval> | null = null;
  let colorIndex = 0;
  let startMs = 0;
  let currentPreview = '';

  function render(): void {
    const color = GRADIENT[colorIndex % GRADIENT.length]!;
    colorIndex++;
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    let line = `  ${color(THINKING_SYMBOL)} ${colors.dim('Thinking...')} ${colors.dim(elapsed + 's')}`;
    if (currentPreview) {
      const trimmed = currentPreview.slice(0, 80).replace(/\n/g, ' ');
      line += `\n  ${colors.dim(trimmed)}`;
    }
    // Clear current line(s) and rewrite
    const lineCount = currentPreview ? 2 : 1;
    process.stdout.write(`\x1B[${lineCount}A\x1B[0J` + line + '\n');
  }

  return {
    start() {
      startMs = Date.now();
      colorIndex = 0;
      currentPreview = '';
      // Print initial placeholder line so cursor-up works
      process.stdout.write(`  ${GRADIENT[0]!(THINKING_SYMBOL)} ${colors.dim('Thinking...')} ${colors.dim('0.0s')}\n`);
      timer = setInterval(render, 150);
    },

    update(preview?: string) {
      if (preview !== undefined) {
        // If switching from no-preview to preview, add an extra line for cursor math
        if (!currentPreview && preview) {
          process.stdout.write('\n');
        }
        currentPreview = preview;
      }
    },

    stop(): string {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
      // Erase the thinking indicator line(s)
      const lineCount = currentPreview ? 2 : 1;
      process.stdout.write(`\x1B[${lineCount}A\x1B[0J`);
      currentPreview = '';
      return `${elapsed}s`;
    },
  };
}

// ── Token / Cost Formatting ──────────────────────────────────────────

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

export function renderTurnFooter(opts: {
  inputTokens: number;
  outputTokens: number;
  cost: number;
  elapsed: string;
}): string {
  const inTok = formatTokenCount(opts.inputTokens);
  const outTok = formatTokenCount(opts.outputTokens);
  const cost = formatCost(opts.cost);
  return colors.dim(`    ${inTok} in ${colors.dim('\u00b7')} ${outTok} out  \u2500  ~${cost}  \u2500  ${opts.elapsed}`);
}

// ── Response Framing ─────────────────────────────────────────────────

export function renderAgentHeader(name: string, elapsed: string): string {
  return `\n  ${colors.secondary('\u25C6')} ${colors.secondary(name)}  ${colors.dim(elapsed)}`;
}

export function renderTurnSeparator(): string {
  return colors.dim('  ' + '\u2500'.repeat(40));
}

export function renderUserPrompt(): string {
  return colors.primary('  \u276F ');
}

// ── Tool Call/Result Rendering ────────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  bash: '\u2318',         // ⌘
  read: '\u25C9',         // ◉
  write: '\u270E',        // ✎
  edit: '\u270F',         // ✏
  web_browse: '\u25CE',   // ◎
  browser: '\u229E',      // ⊞
  google: '\u2726',       // ✦
  consult_agent: '\u21C4', // ⇄
  delegate_task: '\u2197', // ↗
  cron: '\u23F2',         // ⏲
  image: '\u25D0',        // ◐
  message: '\u2709',      // ✉
  session: '\u2299',      // ⊙
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
  const argDisplay = arg ? ` ${colors.dim('\u2500')} ${colors.dim(arg)}` : '';
  return `  ${colors.secondary(icon)} ${colors.white(toolName)}${argDisplay}`;
}

export function renderToolResult(result: { content: string; isError?: boolean }, toolName: string): string {
  if (result.isError) {
    const errMsg = result.content.split('\n')[0]?.slice(0, 80) ?? 'Unknown error';
    return `  ${colors.error('\u2717')} ${colors.white(toolName)} ${colors.error(errMsg)}`;
  }

  const lines = result.content.split('\n');
  const maxLines = 3;
  const maxChars = 80;

  const preview = lines
    .slice(0, maxLines)
    .map(l => (l.length > maxChars ? l.slice(0, maxChars) + '...' : l))
    .map(l => `    ${colors.dim(l)}`)
    .join('\n');

  const remaining = lines.length - maxLines;
  const more = remaining > 0 ? `\n    ${colors.dim(`... +${remaining} lines`)}` : '';

  return `  ${colors.success('\u25B8')} ${colors.white(toolName)}${preview ? '\n' + preview : ''}${more}`;
}

// ── Elapsed Time ──────────────────────────────────────────────────────

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Indent Helper ────────────────────────────────────────────────────

export function indentText(text: string, spaces = 4): string {
  const indent = ' '.repeat(spaces);
  return text
    .split('\n')
    .map(line => indent + line)
    .join('\n');
}
