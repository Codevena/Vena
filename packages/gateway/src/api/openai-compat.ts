import type { FastifyInstance } from 'fastify';
import type { InboundMessage } from '@vena/shared';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { createLogger } from '@vena/shared';

const log = createLogger('gateway:openai-compat');

export interface OpenAICompatOptions {
  onMessage: (msg: InboundMessage) => Promise<{ text?: string }>;
  defaultModel?: string;
}

const chatCompletionSchema = z.object({
  model: z.string().optional(),
  messages: z.array(z.object({
    role: z.string(),
    content: z.string(),
  })).min(1, 'messages must not be empty'),
  stream: z.boolean().optional().default(false),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  user: z.string().optional(),
  session_key: z.string().optional(),
});

export async function openaiCompatAPI(fastify: FastifyInstance, options: OpenAICompatOptions): Promise<void> {
  const { onMessage, defaultModel = 'vena-agent' } = options;

  fastify.post('/v1/chat/completions', async (request, reply) => {
    const parsed = chatCompletionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          message: parsed.error.issues.map(i => i.message).join('; '),
          type: 'invalid_request_error',
        },
      });
    }

    const { model, messages, stream, temperature, max_tokens, user, session_key } = parsed.data;

    // Extract the last user message
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) {
      return reply.status(400).send({
        error: { message: 'At least one user message is required', type: 'invalid_request_error' },
      });
    }

    const sessionKey = session_key ?? `openai-${nanoid(12)}`;
    const inbound: InboundMessage = {
      channelName: 'openai-compat',
      sessionKey,
      userId: user ?? 'openai-api',
      content: lastUserMsg.content,
      raw: { model: model ?? defaultModel, temperature, max_tokens, messages, session_key },
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
