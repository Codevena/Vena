import { Command } from 'commander';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseConfig,
  resolveConfigEnvVars,
} from '@vena/shared';
import type { Message, VenaConfig } from '@vena/shared';
import type { LLMProvider } from '@vena/providers';
import {
  AnthropicProvider,
  OpenAIProvider,
  GeminiProvider,
  OllamaProvider,
} from '@vena/providers';
import {
  colors,
  printLogo,
  divider,
  clearScreen,
  kvLine,
  boxed,
} from '../ui/terminal.js';

// ── Helpers ───────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(os.homedir(), '.vena', 'vena.json');

function loadConfig(): VenaConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `No config found at ${CONFIG_PATH}. Run "vena onboard" first.`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
  const resolved = resolveConfigEnvVars(raw);
  return parseConfig(resolved);
}

/**
 * Create an LLM provider instance. Supports:
 * - API key auth (legacy)
 * - OAuth token auth (new)
 * - Model override (any model string accepted)
 * - Provider override (switch provider at runtime)
 */
function createProvider(
  config: VenaConfig,
  overrideProvider?: string,
  overrideModel?: string,
): { provider: LLMProvider; model: string; providerName: string } {
  const providerName = overrideProvider ?? config.providers.default;

  switch (providerName) {
    case 'anthropic': {
      const cfg = config.providers.anthropic;
      if (!cfg?.apiKey && !cfg?.auth) {
        throw new Error('Anthropic not configured. Set providers.anthropic.apiKey or auth in ~/.vena/vena.json');
      }
      const model = overrideModel ?? cfg?.model ?? 'claude-sonnet-4-5-20250929';
      return {
        provider: new AnthropicProvider({
          apiKey: cfg?.apiKey,
          model,
          baseUrl: cfg?.baseUrl,
          auth: cfg?.auth as any,
        }),
        model,
        providerName,
      };
    }

    case 'openai': {
      const cfg = config.providers.openai;
      if (!cfg?.apiKey && !cfg?.auth) {
        throw new Error('OpenAI not configured. Set providers.openai.apiKey or auth in ~/.vena/vena.json');
      }
      const model = overrideModel ?? cfg?.model ?? 'gpt-4o';
      return {
        provider: new OpenAIProvider({
          apiKey: cfg?.apiKey,
          model,
          baseUrl: cfg?.baseUrl,
          auth: cfg?.auth as any,
        }),
        model,
        providerName,
      };
    }

    case 'gemini': {
      const cfg = config.providers.gemini;
      if (!cfg?.apiKey && !cfg?.auth) {
        throw new Error('Gemini not configured. Set providers.gemini.apiKey or auth in ~/.vena/vena.json');
      }
      const model = overrideModel ?? cfg?.model ?? 'gemini-2.0-flash';
      return {
        provider: new GeminiProvider({
          apiKey: cfg?.apiKey,
          model,
          auth: cfg?.auth as any,
        }),
        model,
        providerName,
      };
    }

    case 'ollama': {
      const cfg = config.providers.ollama;
      const model = overrideModel ?? cfg?.model ?? 'llama3';
      return {
        provider: new OllamaProvider({
          baseUrl: cfg?.baseUrl,
          model,
        }),
        model,
        providerName,
      };
    }

    default:
      throw new Error(`Unknown provider "${providerName}". Supported: anthropic, openai, gemini, ollama`);
  }
}

function makeMessage(role: 'user' | 'assistant', content: string): Message {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: new Date().toISOString(),
  };
}

// ── Chat Command ──────────────────────────────────────────────────────

export const chatCommand = new Command('chat')
  .description('Start an interactive chat session with your agent')
  .option('-m, --model <model>', 'Model to use (e.g. claude-opus-4-6, gpt-4o, gemini-2.0-flash)')
  .option('-p, --provider <name>', 'Provider to use (anthropic, openai, gemini, ollama)')
  .option('-s, --system <prompt>', 'Set a custom system prompt')
  .action(async (opts: { model?: string; provider?: string; system?: string }) => {
    // Load config and create provider
    let config: VenaConfig;
    try {
      config = loadConfig();
    } catch (err) {
      console.error(colors.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }

    let provider: LLMProvider;
    let modelName: string;
    let providerName: string;
    try {
      const result = createProvider(config, opts.provider, opts.model);
      provider = result.provider;
      modelName = result.model;
      providerName = result.providerName;
    } catch (err) {
      console.error(colors.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`));
      process.exit(1);
    }

    const systemPrompt = opts.system ?? config.agents.registry[0]?.persona ?? 'You are a helpful assistant.';

    // Conversation state
    const messages: Message[] = [];
    let totalTokens = 0;

    // ── Render header ───────────────────────────────────────────────
    clearScreen();
    await printLogo(true);
    console.log();
    console.log(
      boxed(
        [
          kvLine('Provider', provider.name, 14),
          kvLine('Model', modelName, 14),
          kvLine('Context', `${(provider.maxContextWindow / 1000).toFixed(0)}k tokens`, 14),
        ],
        { title: 'Chat Session', padding: 1 },
      ),
    );
    console.log();
    console.log(colors.dim('  Type "exit" or press Ctrl+C to quit.'));
    console.log(colors.dim('  Type "/clear" to reset the conversation.'));
    console.log();
    console.log(divider());
    console.log();

    // ── Readline setup ──────────────────────────────────────────────
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Graceful Ctrl+C
    let isStreaming = false;

    rl.on('SIGINT', () => {
      if (isStreaming) {
        // If we are mid-stream, just note it and let the loop handle cleanup
        isStreaming = false;
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

    // ── Prompt loop ─────────────────────────────────────────────────
    function promptUser(): void {
      const tokenInfo = totalTokens > 0 ? colors.dim(` [~${totalTokens} tokens]`) : '';
      const promptStr = colors.primary('  you ') + colors.dim(`(${modelName})`) + tokenInfo + colors.primary(' > ');

      rl.question(promptStr, async (input) => {
        const trimmed = input.trim();

        // Exit commands
        if (
          trimmed.toLowerCase() === 'exit' ||
          trimmed.toLowerCase() === 'quit' ||
          trimmed.toLowerCase() === '/quit' ||
          trimmed.toLowerCase() === '/exit'
        ) {
          console.log(colors.dim('\n  Goodbye!\n'));
          rl.close();
          return;
        }

        // Clear conversation
        if (trimmed.toLowerCase() === '/clear') {
          messages.length = 0;
          totalTokens = 0;
          console.log(colors.success('\n  Conversation cleared.\n'));
          promptUser();
          return;
        }

        // Empty input
        if (!trimmed) {
          promptUser();
          return;
        }

        // Add user message
        messages.push(makeMessage('user', trimmed));

        // Stream LLM response
        process.stdout.write('\n  ' + colors.secondary('vena') + colors.dim(' > '));

        let responseText = '';
        isStreaming = true;

        try {
          const stream = provider.chat({
            messages,
            systemPrompt,
            stream: true,
          });

          for await (const chunk of stream) {
            if (!isStreaming) break; // interrupted by Ctrl+C

            switch (chunk.type) {
              case 'text':
                if (chunk.text) {
                  process.stdout.write(chunk.text);
                  responseText += chunk.text;
                }
                break;

              case 'error':
                process.stdout.write(
                  colors.error(`\n  Error: ${chunk.error ?? 'Unknown error'}`),
                );
                break;

              case 'stop':
                // End of response
                break;
            }
          }
        } catch (err) {
          if (isStreaming) {
            // Only show error if we were not interrupted
            const errMsg = err instanceof Error ? err.message : String(err);
            process.stdout.write(colors.error(`\n\n  Error: ${errMsg}`));
          }
        }

        isStreaming = false;

        // Finalize: add assistant message to history
        if (responseText) {
          messages.push(makeMessage('assistant', responseText));
        }

        // Update token estimate
        try {
          totalTokens = await provider.countTokens(messages);
        } catch {
          // Non-critical; keep the old count
        }

        process.stdout.write('\n\n');
        promptUser();
      });
    }

    promptUser();
  });
