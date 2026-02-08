import { Command } from 'commander';
import readline from 'node:readline';
import ora from 'ora';
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
} from '../ui/terminal.js';
import { loadConfig, createProvider, DATA_DIR } from '../lib/runtime.js';

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
    console.log(colors.dim('  Type /help for commands. Type /exit to quit.'));
    console.log();

    // ── Readline setup ───────────────────────────────────────────────
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    let isStreaming = false;
    let activeSpinner: ReturnType<typeof ora> | null = null;

    rl.on('SIGINT', () => {
      if (isStreaming) {
        isStreaming = false;
        if (activeSpinner) {
          activeSpinner.stop();
          activeSpinner = null;
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
          console.log(colors.dim('  ─'.repeat(20)));
          console.log(`  ${colors.white('/help')}     ${colors.dim('/h /?')}      ${colors.dim('Show this help')}`);
          console.log(`  ${colors.white('/clear')}    ${colors.dim('/c')}         ${colors.dim('Clear conversation')}`);
          console.log(`  ${colors.white('/status')}   ${colors.dim('/s')}         ${colors.dim('Show session info')}`);
          console.log(`  ${colors.white('/model')}               ${colors.dim('Show provider/model info')}`);
          console.log(`  ${colors.white('/character')} ${colors.dim('/char')}     ${colors.dim('List characters')}`);
          console.log(`  ${colors.white('/exit')}     ${colors.dim('/quit /q')}   ${colors.dim('Exit chat')}`);
          console.log();
          return true;
        }

        case '/clear':
        case '/c': {
          session.messages.length = 0;
          totalTokens = 0;
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
          console.log(colors.dim('  ─'.repeat(20)));
          for (const c of chars) {
            const active = c.id === characterId ? colors.success(' (active)') : '';
            console.log(`  ${colors.primary(c.id.padEnd(8))} ${colors.white(c.name)}${active}`);
            console.log(`  ${' '.repeat(8)} ${colors.dim(c.tagline)}`);
          }
          console.log();
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

    // ── Prompt loop ──────────────────────────────────────────────────
    function promptUser(): void {
      rl.question(colors.primary('  > '), async (input) => {
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

        // ── Send to AgentLoop ──────────────────────────────────────
        const userMessage: Message = {
          id: `msg_${Date.now()}`,
          role: 'user',
          content: trimmed,
          timestamp: new Date().toISOString(),
        };

        const turnStart = Date.now();
        isStreaming = true;
        let receivedText = false;

        // Start spinner
        activeSpinner = ora({
          text: 'Thinking...',
          spinner: 'dots',
          indent: 2,
          color: 'yellow',
        }).start();

        try {
          for await (const event of loop.run(userMessage, session)) {
            if (!isStreaming) break;

            switch (event.type) {
              case 'text': {
                if (!receivedText) {
                  // Stop spinner on first text chunk, print agent header
                  if (activeSpinner) {
                    activeSpinner.stop();
                    activeSpinner = null;
                  }
                  const elapsed = formatElapsed(Date.now() - turnStart);
                  const agentLabel = character?.name.toLowerCase() ?? 'vena';
                  process.stdout.write(`\n  ${colors.secondary(agentLabel)} ${colors.dim(elapsed)}\n\n  `);
                  receivedText = true;
                }
                process.stdout.write(event.text);
                break;
              }

              case 'tool_call': {
                if (activeSpinner) {
                  activeSpinner.stop();
                  activeSpinner = null;
                }
                if (receivedText) {
                  process.stdout.write('\n');
                }
                console.log();
                console.log(renderToolCall(event.tool, event.input));
                break;
              }

              case 'tool_result': {
                console.log(renderToolResult(event.result, event.result.metadata?.['toolName'] as string ?? ''));
                console.log();
                // Restart spinner for next LLM turn
                activeSpinner = ora({
                  text: 'Thinking...',
                  spinner: 'dots',
                  indent: 2,
                  color: 'yellow',
                }).start();
                receivedText = false;
                break;
              }

              case 'done': {
                if (activeSpinner) {
                  activeSpinner.stop();
                  activeSpinner = null;
                }
                // If no text was streamed but we have a response, print it
                if (!receivedText && event.response) {
                  const elapsed = formatElapsed(Date.now() - turnStart);
                  const agentLabel = character?.name.toLowerCase() ?? 'vena';
                  console.log(`\n  ${colors.secondary(agentLabel)} ${colors.dim(elapsed)}\n`);
                  console.log(`  ${event.response}`);
                }
                break;
              }

              case 'error': {
                if (activeSpinner) {
                  activeSpinner.stop();
                  activeSpinner = null;
                }
                console.log(colors.error(`\n  Error: ${event.error.message}\n`));
                break;
              }
            }
          }
        } catch (err) {
          if (activeSpinner) {
            activeSpinner.stop();
            activeSpinner = null;
          }
          if (isStreaming) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.log(colors.error(`\n  Error: ${errMsg}`));
          }
        }

        isStreaming = false;

        // Update token estimate
        try {
          totalTokens = await providerInstance.countTokens(session.messages);
        } catch {
          // Non-critical
        }

        process.stdout.write('\n\n');
        promptUser();
      });
    }

    promptUser();
  });
