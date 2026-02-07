import { Command } from 'commander';
import readline from 'node:readline';
import type { Message } from '@vena/shared';
import type { LLMProvider } from '@vena/providers';
import {
  colors,
  printLogo,
  divider,
  clearScreen,
  kvLine,
  boxed,
} from '../ui/terminal.js';
import { loadConfig, createProvider } from '../lib/runtime.js';

// ── Helpers ───────────────────────────────────────────────────────────

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
    let config;
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
