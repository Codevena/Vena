import type { FastifyInstance } from 'fastify';
import type { InboundMessage } from '@vena/shared';
import { nanoid } from 'nanoid';
import { createLogger } from '@vena/shared';

const log = createLogger('gateway:openai-compat');

export interface OpenAICompatOptions {
  onMessage: (msg: InboundMessage) => Promise<{ text?: string }>;
  defaultModel?: string;
}

interface ChatCompletionRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

export async function openaiCompatAPI(fastify: FastifyInstance, options: OpenAICompatOptions): Promise<void> {
  const { onMessage, defaultModel = 'vena-agent' } = options;

  fastify.post<{ Body: ChatCompletionRequest }>('/v1/chat/completions', async (request, reply) => {
    const { model, messages, stream = false, temperature, max_tokens } = request.body;

    if (!messages || messages.length === 0) {
      return reply.status(400).send({
        error: { message: 'messages is required and must not be empty', type: 'invalid_request_error' },
      });
    }

    // Extract the last user message
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) {
      return reply.status(400).send({
        error: { message: 'At least one user message is required', type: 'invalid_request_error' },
      });
    }

    const sessionKey = `openai-${nanoid(12)}`;
    const inbound: InboundMessage = {
      channelName: 'openai-compat',
      sessionKey,
      userId: 'openai-api',
      content: lastUserMsg.content,
      raw: { model: model ?? defaultModel, temperature, max_tokens, messages },
    };

    log.debug({ model: model ?? defaultModel, stream, messageCount: messages.length }, 'OpenAI compat request');

    const response = await onMessage(inbound);
    const responseText = response.text ?? '';
    const completionId = `chatcmpl-${nanoid(24)}`;
    const created = Math.floor(Date.now() / 1000);

    if (stream) {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // Send the response as a single SSE chunk
      const chunk = {
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model: model ?? defaultModel,
        choices: [{
          index: 0,
          delta: { role: 'assistant', content: responseText },
          finish_reason: null,
        }],
      };
      reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);

      // Send the final chunk
      const finalChunk = {
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model: model ?? defaultModel,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: 'stop',
        }],
      };
      reply.raw.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
      return reply;
    }

    return {
      id: completionId,
      object: 'chat.completion',
      created,
      model: model ?? defaultModel,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: responseText,
        },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    };
  });
}
