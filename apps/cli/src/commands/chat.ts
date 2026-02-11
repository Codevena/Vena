import { Command } from 'commander';
import readline from 'node:readline';
import type { Message, Session, Tool } from '@vena/shared';
import { getCharacter, listCharacters } from '@vena/shared';
import {
  AgentLoop,
  MemoryManager,
  BashTool,
  ReadTool,
  WriteTool,
  EditTool,
  WebBrowseTool,
  ToolGuard,
  SoulCompiler,
} from '@vena/core';
import type { SecurityPolicy } from '@vena/core';
import type { LLMProvider } from '@vena/providers';
import {
  colors,
  printLogo,
  clearScreen,
  kvLine,
  boxed,
  renderToolCall,
  renderToolResult,
  formatElapsed,
  renderMarkdown,
  createThinkingIndicator,
  formatTokenCount,
  formatCost,
  renderTurnFooter,
  renderAgentHeader,
  renderTurnSeparator,
  renderUserPrompt,
  indentText,
} from '../ui/terminal.js';
import { loadConfig, createProvider, DATA_DIR } from '../lib/runtime.js';

// ── Pricing (per 1M tokens, USD) ─────────────────────────────────────

const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'o1': { input: 15.0, output: 60.0 },
  'o1-mini': { input: 3.0, output: 12.0 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'default': { input: 1.0, output: 3.0 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING[model] ?? PRICING['default']!;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

// ── Chat Command ──────────────────────────────────────────────────────

export const chatCommand = new Command('chat')
  .description('Start an interactive chat session with your agent')
  .option('-m, --model <model>', 'Model to use (e.g. claude-opus-4-6, gpt-4o, gemini-2.0-flash)')
  .option('-p, --provider <name>', 'Provider to use (anthropic, openai, gemini, ollama)')
  .option('-s, --system <prompt>', 'Set a custom system prompt')
  .option('-c, --character <id>', 'Character to use (nova, sage, spark, ghost, atlas)')
  .action(async (opts: { model?: string; provider?: string; system?: string; character?: string }) => {
    // ── Load config + provider ───────────────────────────────────────
    let config;
    try {
      config = loadConfig();
    } catch (err) {
      console.error(colors.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }

    let providerInstance: LLMProvider;
    let modelName: string;
    let providerName: string;
    try {
      const result = createProvider(config, opts.provider, opts.model);
      providerInstance = result.provider;
      modelName = result.model;
      providerName = result.providerName;
    } catch (err) {
      console.error(colors.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }

    // ── Character + Soul prompt ──────────────────────────────────────
    const characterId = opts.character ?? config.agents.registry[0]?.character ?? 'nova';
    const character = getCharacter(characterId);
    let soulPrompt: string | undefined;
    if (character) {
      const compiler = new SoulCompiler();
      soulPrompt = compiler.compile(character, config.userProfile);
    }

    const basePrompt = opts.system ?? config.agents.registry[0]?.persona ?? 'You are a helpful assistant.';
    const systemPrompt = basePrompt;

    // ── Build tools + guard ──────────────────────────────────────────
    const trustLevel = (config.agents.registry[0]?.trustLevel ?? config.security.defaultTrustLevel ?? 'limited') as
      'full' | 'limited' | 'readonly';

    const securityPolicy: SecurityPolicy = {
      trustLevel,
      allowedTools: ['*'],
      allowedPaths: [DATA_DIR, process.cwd()],
      blockedPaths: config.security.pathPolicy.blockedPatterns,
      allowedCommands: config.security.shell.allowedCommands,
      maxOutputBytes: 1024 * 1024,
      envPassthrough: config.security.shell.envPassthrough,
      allowPrivateIPs: config.security.urlPolicy.allowPrivateIPs,
    };

    const guard = new ToolGuard(securityPolicy);
    const tools: Tool[] = [
      new ReadTool(),
      new WebBrowseTool({ allowPrivateIPs: config.security.urlPolicy.allowPrivateIPs }),
    ];

    if (trustLevel !== 'readonly') {
      tools.push(new WriteTool());
      tools.push(new EditTool());
    }

    if (trustLevel === 'full' && config.computer.shell.enabled) {
      tools.push(new BashTool({ envPassthrough: config.security.shell.envPassthrough }));
    }

    const toolNames = tools.map(t => t.name);

    // ── Memory manager ───────────────────────────────────────────────
    const agentId = config.agents.registry[0]?.id ?? 'chat';
    const memoryManager = new MemoryManager({
      workspacePath: DATA_DIR,
      agentId,
    });

    // ── Agent loop ───────────────────────────────────────────────────
    const loop = new AgentLoop({
      provider: providerInstance,
      tools,
      systemPrompt,
      soulPrompt,
      memoryManager,
      guard,
      workspacePath: process.cwd(),
      options: {
        maxIterations: 10,
        maxTokens: 4096,
        streamTools: true,
      },
    });

    // ── Session ──────────────────────────────────────────────────────
    const session: Session = {
      id: `sess_chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      channelName: 'cli',
      sessionKey: `cli:chat:${Date.now()}`,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        userId: 'cli-user',
        agentId,
        tokenCount: 0,
        compactionCount: 0,
      },
    };

    const startTime = Date.now();
    let totalTokens = 0;

    // ── Session usage tracking ───────────────────────────────────────
    const sessionUsage = {
      totalInput: 0,
      totalOutput: 0,
      totalCost: 0,
      turns: 0,
    };

    // ── Display preferences ──────────────────────────────────────────
    let showThinkingPreview = true;
    let compactMode = false;

    // ── Render header ────────────────────────────────────────────────
    clearScreen();
    await printLogo(true);
    console.log();
    console.log(
      boxed(
        [
          kvLine('Provider', providerName, 15),
          kvLine('Model', modelName, 15),
          kvLine('Character', character?.name ?? 'Default', 15),
          kvLine('Trust', trustLevel, 15),
          kvLine('Tools', toolNames.join(', '), 15),
        ],
        { title: 'Chat Session', padding: 1 },
      ),
    );
    console.log();

    // ── Character greeting ───────────────────────────────────────────
    if (character?.greeting) {
      console.log(`  ${colors.secondary('\u25C6')} ${colors.dim(character.greeting)}`);
      console.log();
    }

    // ── Quick tips ───────────────────────────────────────────────────
    console.log(colors.dim('  tip: Use ``` for multiline input  \u00b7  /help for commands'));
    console.log();

    // ── Readline setup ───────────────────────────────────────────────
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    let isStreaming = false;
    let thinkingIndicator: ReturnType<typeof createThinkingIndicator> | null = null;

    rl.on('SIGINT', () => {
      if (isStreaming) {
        isStreaming = false;
        if (thinkingIndicator) {
          thinkingIndicator.stop();
          thinkingIndicator = null;
        }
        process.stdout.write('\n');
        console.log(colors.dim('  (interrupted)'));
        console.log();
        promptUser();
      } else {
        console.log(colors.dim('\n  Goodbye!\n'));
        rl.close();
        process.exit(0);
      }
    });

    rl.on('close', () => {
      process.exit(0);
    });

    // ── Slash commands ───────────────────────────────────────────────
    function handleSlashCommand(input: string): boolean {
      const cmd = input.toLowerCase().trim();

      switch (cmd) {
        case '/help':
        case '/h':
        case '/?': {
          console.log();
          console.log(colors.secondary('  Commands'));
          console.log(colors.dim('  ' + '\u2500'.repeat(40)));
          console.log(`  ${colors.white('/help')}      ${colors.dim('/h /?')}      ${colors.dim('Show this help')}`);
          console.log(`  ${colors.white('/clear')}     ${colors.dim('/c')}         ${colors.dim('Clear conversation')}`);
          console.log(`  ${colors.white('/status')}    ${colors.dim('/s')}         ${colors.dim('Show session info')}`);
          console.log(`  ${colors.white('/usage')}     ${colors.dim('/u')}         ${colors.dim('Token & cost stats')}`);
          console.log(`  ${colors.white('/model')}                ${colors.dim('Show provider/model info')}`);
          console.log(`  ${colors.white('/character')}  ${colors.dim('/char')}     ${colors.dim('List characters')}`);
          console.log(`  ${colors.white('/history')}              ${colors.dim('Recent messages')}`);
          console.log(`  ${colors.white('/thinking')}  ${colors.dim('/t')}        ${colors.dim('Toggle thinking preview')}`);
          console.log(`  ${colors.white('/compact')}              ${colors.dim('Toggle compact display')}`);
          console.log(`  ${colors.white('/exit')}      ${colors.dim('/quit /q')}   ${colors.dim('Exit chat')}`);
          console.log();
          return true;
        }

        case '/clear':
        case '/c': {
          session.messages.length = 0;
          totalTokens = 0;
          sessionUsage.totalInput = 0;
          sessionUsage.totalOutput = 0;
          sessionUsage.totalCost = 0;
          sessionUsage.turns = 0;
          console.log(colors.success('\n  Conversation cleared.\n'));
          return true;
        }

        case '/status':
        case '/s': {
          const elapsed = Date.now() - startTime;
          const mins = Math.floor(elapsed / 60000);
          const secs = Math.floor((elapsed % 60000) / 1000);
          const uptime = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
          const msgCount = session.messages.filter(m => m.role === 'user').length;
          const assistantCount = session.messages.filter(m => m.role === 'assistant').length;

          console.log();
          console.log(
            boxed(
              [
                kvLine('Session', session.id.slice(0, 20), 14),
                kvLine('Uptime', uptime, 14),
                kvLine('Messages', `${msgCount} user, ${assistantCount} assistant`, 14),
                kvLine('Tokens', `~${totalTokens}`, 14),
                kvLine('Model', modelName, 14),
                kvLine('Trust', trustLevel, 14),
              ],
              { title: 'Status', padding: 1 },
            ),
          );
          console.log();
          return true;
        }

        case '/usage':
        case '/u': {
          const costStr = formatCost(sessionUsage.totalCost);
          const inStr = formatTokenCount(sessionUsage.totalInput);
          const outStr = formatTokenCount(sessionUsage.totalOutput);

          console.log();
          console.log(
            boxed(
              [
                kvLine('Turns', String(sessionUsage.turns), 14),
                kvLine('Input tokens', inStr, 14),
                kvLine('Output tokens', outStr, 14),
                kvLine('Est. cost', `~${costStr}`, 14),
                kvLine('Model', modelName, 14),
              ],
              { title: 'Usage', padding: 1 },
            ),
          );
          console.log();
          return true;
        }

        case '/model': {
          console.log();
          console.log(
            boxed(
              [
                kvLine('Provider', providerName, 14),
                kvLine('Model', modelName, 14),
                kvLine('Character', character?.name ?? 'Default', 14),
                kvLine('Trust', trustLevel, 14),
                kvLine('Tools', toolNames.join(', '), 14),
              ],
              { title: 'Model', padding: 1 },
            ),
          );
          console.log();
          return true;
        }

        case '/character':
        case '/char': {
          const chars = listCharacters();
          console.log();
          console.log(colors.secondary('  Characters'));
          console.log(colors.dim('  ' + '\u2500'.repeat(40)));
          for (const c of chars) {
            const active = c.id === characterId ? colors.success(' (active)') : '';
            console.log(`  ${colors.primary(c.id.padEnd(8))} ${colors.white(c.name)}${active}`);
            console.log(`  ${' '.repeat(8)} ${colors.dim(c.tagline)}`);
          }
          console.log();
          return true;
        }

        case '/history': {
          const recent = session.messages.slice(-20);
          if (recent.length === 0) {
            console.log(colors.dim('\n  No messages yet.\n'));
            return true;
          }
          console.log();
          for (const msg of recent) {
            const role = msg.role === 'user'
              ? colors.primary('\u276F')
              : colors.secondary('\u25C6');
            const content = typeof msg.content === 'string'
              ? msg.content.slice(0, 80)
              : '[complex content]';
            const suffix = typeof msg.content === 'string' && msg.content.length > 80 ? '...' : '';
            console.log(`  ${role} ${colors.dim(content + suffix)}`);
          }
          console.log();
          return true;
        }

        case '/thinking':
        case '/t': {
          showThinkingPreview = !showThinkingPreview;
          console.log(colors.dim(`\n  Thinking preview: ${showThinkingPreview ? 'on' : 'off'}\n`));
          return true;
        }

        case '/compact': {
          compactMode = !compactMode;
          console.log(colors.dim(`\n  Compact mode: ${compactMode ? 'on' : 'off'}\n`));
          return true;
        }

        case '/exit':
        case '/quit':
        case '/q': {
          console.log(colors.dim('\n  Goodbye!\n'));
          rl.close();
          return true;
        }

        default:
          return false;
      }
    }

    // ── Multiline input helper ───────────────────────────────────────
    function readMultilineInput(): Promise<string> {
      return new Promise((resolve) => {
        const lines: string[] = [];
        console.log(colors.dim('  ... multiline mode (close with ```)'));
        const handler = (line: string) => {
          if (line.trimStart().startsWith('```')) {
            rl.removeListener('line', handler);
            resolve(lines.join('\n'));
          } else {
            lines.push(line);
            process.stdout.write(colors.dim('  ... '));
          }
        };
        rl.on('line', handler);
        process.stdout.write(colors.dim('  ... '));
      });
    }

    // ── Prompt loop ──────────────────────────────────────────────────
    function promptUser(): void {
      rl.question(renderUserPrompt(), async (input) => {
        const trimmed = input.trim();

        if (!trimmed) {
          promptUser();
          return;
        }

        // Legacy exit commands
        if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
          console.log(colors.dim('\n  Goodbye!\n'));
          rl.close();
          return;
        }

        // Slash commands
        if (trimmed.startsWith('/')) {
          if (handleSlashCommand(trimmed)) {
            promptUser();
            return;
          }
          console.log(colors.dim(`\n  Unknown command: ${trimmed}. Type /help for commands.\n`));
          promptUser();
          return;
        }

        // Multiline input: ``` opens multiline mode
        let messageContent = trimmed;
        if (trimmed.startsWith('```')) {
          const rest = trimmed.slice(3).trim();
          if (rest) {
            // Single line with ``` prefix, treat as normal
            messageContent = rest;
          } else {
            messageContent = await readMultilineInput();
            if (!messageContent.trim()) {
              promptUser();
              return;
            }
          }
        }

        // ── Send to AgentLoop ──────────────────────────────────────
        const userMessage: Message = {
          id: `msg_${Date.now()}`,
          role: 'user',
          content: messageContent,
          timestamp: new Date().toISOString(),
        };

        const turnStart = Date.now();
        isStreaming = true;
        let receivedText = false;
        let responseBuffer = '';
        let streamLineCount = 0;
        let turnUsage = { inputTokens: 0, outputTokens: 0 };

        // Start thinking indicator
        thinkingIndicator = createThinkingIndicator();
        thinkingIndicator.start();

        try {
          for await (const event of loop.run(userMessage, session)) {
            if (!isStreaming) break;

            switch (event.type) {
              case 'thinking': {
                if (thinkingIndicator && showThinkingPreview) {
                  thinkingIndicator.update(event.thinking);
                }
                break;
              }

              case 'text': {
                if (!receivedText) {
                  // Stop thinking indicator on first text chunk, print agent header
                  if (thinkingIndicator) {
                    thinkingIndicator.stop();
                    thinkingIndicator = null;
                  }
                  const elapsed = formatElapsed(Date.now() - turnStart);
                  const agentLabel = character?.name.toLowerCase() ?? 'vena';
                  const header = renderAgentHeader(agentLabel, elapsed);
                  console.log(header);
                  process.stdout.write('\n    ');
                  receivedText = true;
                  streamLineCount = 1; // The header line
                }
                // Stream raw text for instant feedback
                process.stdout.write(event.text);
                responseBuffer += event.text;
                // Track newlines for cursor rewrite
                const newlines = (event.text.match(/\n/g) || []).length;
                if (newlines > 0) {
                  streamLineCount += newlines;
                  // Add indent after each newline for consistent layout
                  // (Already streamed, so this is just for counting)
                }
                break;
              }

              case 'tool_call': {
                if (thinkingIndicator) {
                  thinkingIndicator.stop();
                  thinkingIndicator = null;
                }
                if (receivedText) {
                  process.stdout.write('\n');
                }
                console.log();
                console.log(renderToolCall(event.tool, event.input));
                break;
              }

              case 'tool_result': {
                if (!compactMode) {
                  console.log(renderToolResult(event.result, event.result.metadata?.['toolName'] as string ?? ''));
                }
                console.log();
                // Restart thinking indicator for next LLM turn
                thinkingIndicator = createThinkingIndicator();
                thinkingIndicator.start();
                receivedText = false;
                responseBuffer = '';
                streamLineCount = 0;
                break;
              }

              case 'usage': {
                turnUsage = {
                  inputTokens: event.inputTokens,
                  outputTokens: event.outputTokens,
                };
                break;
              }

              case 'done': {
                if (thinkingIndicator) {
                  thinkingIndicator.stop();
                  thinkingIndicator = null;
                }

                if (!receivedText && event.response) {
                  // No text was streamed but we have a response
                  const elapsed = formatElapsed(Date.now() - turnStart);
                  const agentLabel = character?.name.toLowerCase() ?? 'vena';
                  console.log(renderAgentHeader(agentLabel, elapsed));
                  console.log();
                  const rendered = renderMarkdown(event.response);
                  console.log(indentText(rendered, 4));
                } else if (receivedText && responseBuffer) {
                  // Rewrite streamed text with rendered markdown
                  // Count how many terminal lines the raw output took
                  const rawLines = responseBuffer.split('\n');
                  // +1 for the initial indent line, rawLines count = newlines + 1
                  const linesToErase = rawLines.length;

                  process.stdout.write('\x1B[?25l'); // hide cursor
                  // Move up and erase the raw streamed text
                  if (linesToErase > 0) {
                    process.stdout.write(`\x1B[${linesToErase}A\x1B[0J`);
                  }

                  const rendered = renderMarkdown(responseBuffer);
                  console.log(indentText(rendered, 4));
                  process.stdout.write('\x1B[?25h'); // restore cursor
                }
                break;
              }

              case 'error': {
                if (thinkingIndicator) {
                  thinkingIndicator.stop();
                  thinkingIndicator = null;
                }
                console.log(colors.error(`\n  Error: ${event.error.message}\n`));
                break;
              }
            }
          }
        } catch (err) {
          if (thinkingIndicator) {
            thinkingIndicator.stop();
            thinkingIndicator = null;
          }
          if (isStreaming) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.log(colors.error(`\n  Error: ${errMsg}`));
          }
        }

        isStreaming = false;

        // ── Turn footer: usage + cost ────────────────────────────────
        const turnElapsed = formatElapsed(Date.now() - turnStart);

        if (turnUsage.inputTokens > 0 || turnUsage.outputTokens > 0) {
          const cost = estimateCost(modelName, turnUsage.inputTokens, turnUsage.outputTokens);
          sessionUsage.totalInput += turnUsage.inputTokens;
          sessionUsage.totalOutput += turnUsage.outputTokens;
          sessionUsage.totalCost += cost;
          sessionUsage.turns++;

          console.log();
          console.log(renderTurnFooter({
            inputTokens: turnUsage.inputTokens,
            outputTokens: turnUsage.outputTokens,
            cost,
            elapsed: turnElapsed,
          }));
        }

        // Update token estimate
        try {
          totalTokens = await providerInstance.countTokens(session.messages);
        } catch {
          // Non-critical
        }

        // Turn separator
        console.log(renderTurnSeparator());
        console.log();
        promptUser();
      });
    }

    promptUser();
  });
