import type { VenaConfig, InboundMessage, Message, OutboundMessage, AgentConfig } from '@vena/shared';
import { createLogger } from '@vena/shared';
import type { AgentLoop, MemoryManager, UsageTracker } from '@vena/core';
import type { VoiceMessagePipeline } from '@vena/voice';
import type { MeshNetwork } from '@vena/agents';
import { SenderApproval } from '@vena/gateway';
import { triggerHook, createHookEvent } from '@vena/hooks';
import { ChatSessionManager } from './session-manager.js';
import {
  extractOpenAiHistory,
  extractOpenAiSystemMessages,
  extractOpenAiSystemPrompt,
  mapOpenAiMessages,
} from './openai-compat.js';
import type { OpenAICompatRaw } from './openai-compat.js';

const log = createLogger('cli:handler');

export interface MessageHandlerDeps {
  config: VenaConfig;
  registry: AgentConfig[];
  defaultAgentId: string;
  providerName: string;
  modelName: string;
  agentLoops: Map<string, AgentLoop>;
  agentMemory: Map<string, MemoryManager>;
  agentProviderNames: Map<string, string>;
  mesh?: MeshNetwork;
  voicePipeline?: VoiceMessagePipeline;
  sessions: ChatSessionManager;
  usageTracker: UsageTracker;
  senderApproval: SenderApproval;
}

export interface MessageHandlerResult {
  handleMessage: (inbound: InboundMessage) => Promise<{ text?: string }>;
  handleChannelMessage: (
    inbound: InboundMessage,
    sendFn: (key: string, content: OutboundMessage) => Promise<void>,
  ) => Promise<void>;
  selectAgent: (content: string) => Promise<string>;
  getMessageCount: () => number;
}

export function createMessageHandler(deps: MessageHandlerDeps): MessageHandlerResult {
  const {
    config,
    registry,
    defaultAgentId,
    providerName,
    modelName,
    agentLoops,
    agentMemory,
    agentProviderNames,
    mesh,
    voicePipeline,
    sessions,
    usageTracker,
    senderApproval,
  } = deps;

  let totalMessages = 0;
  const firstAgentConfig = registry[0];

  async function selectAgent(content: string): Promise<string> {
    if (!mesh || registry.length <= 1) return defaultAgentId;

    try {
      return await mesh.routeMessageAsync(content, defaultAgentId);
    } catch {
      return defaultAgentId;
    }
  }

  async function handleMessage(inbound: InboundMessage): Promise<{ text?: string }> {
    totalMessages++;

    // Voice transcription: if inbound has audio/voice media, transcribe it
    let content = inbound.content;
    const hasVoice = inbound.media?.some(m => m.type === 'voice' || m.type === 'audio');

    if (voicePipeline && hasVoice) {
      const voiceMedia = inbound.media!.find(m => m.type === 'voice' || m.type === 'audio');
      if (voiceMedia?.buffer) {
        try {
          const transcribed = await voicePipeline.processIncoming(voiceMedia.buffer, voiceMedia.mimeType);
          if (transcribed) {
            content = transcribed;
            log.info({ original: !!inbound.content, transcribed: transcribed.slice(0, 100) }, 'Voice transcribed');
          }
        } catch (err) {
          log.error({ error: err }, 'Voice transcription failed');
        }
      }
    }

    // Route to best agent
    const targetAgentId = await selectAgent(content);
    const loop = agentLoops.get(targetAgentId) ?? agentLoops.get(defaultAgentId)!;
    const mm = agentMemory.get(targetAgentId) ?? agentMemory.get(defaultAgentId)!;

    if (targetAgentId !== defaultAgentId) {
      log.info({ target: targetAgentId, content: content.slice(0, 80) }, 'Routed to agent');
    }

    let session;
    let systemPromptOverride: string | undefined;
    const raw = inbound.raw as OpenAICompatRaw | undefined;
    const rawMessages = Array.isArray(raw?.messages) ? raw!.messages! : null;
    if (rawMessages && inbound.channelName === 'openai-compat') {
      const targetProvider = agentProviderNames.get(targetAgentId) ?? providerName;
      const isOpenAIProvider = targetProvider === 'openai';
      const history = extractOpenAiHistory(rawMessages);
      const systemMessages = extractOpenAiSystemMessages(rawMessages);
      let seedMessages = mapOpenAiMessages(history);

      if (isOpenAIProvider && systemMessages.length > 0) {
        const systemSeeds = mapOpenAiMessages(systemMessages.map((c) => ({ role: 'system', content: c })));
        seedMessages = [...systemSeeds, ...seedMessages];
      }
      session = sessions.createEphemeral(
        inbound.sessionKey,
        inbound.channelName,
        inbound.userId,
        targetAgentId,
        seedMessages,
      );
      const systemPrompt = !isOpenAIProvider ? extractOpenAiSystemPrompt(rawMessages) : undefined;
      if (systemPrompt) {
        const targetConfig = registry.find(a => a.id === targetAgentId) ?? firstAgentConfig;
        const basePrompt = targetConfig?.persona ?? 'You are a helpful AI assistant.';
        systemPromptOverride = [systemPrompt, basePrompt].join('\n\n');
      }
    } else {
      session = sessions.getOrCreate(
        inbound.sessionKey,
        inbound.channelName,
        inbound.userId,
        targetAgentId,
      );
    }

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
      metadata: {
        userId: inbound.userId,
        userName: inbound.userName,
        channelName: inbound.channelName,
      },
    };

    let responseText = '';

    // Hook: session message received
    triggerHook(createHookEvent('session', 'message', inbound.sessionKey, {
      userId: inbound.userId,
      channel: inbound.channelName,
      agentId: targetAgentId,
      content: content.slice(0, 200),
    })).catch(() => {});

    try {
      const overrides = systemPromptOverride ? { systemPrompt: systemPromptOverride } : undefined;
      for await (const event of loop.run(userMessage, session, overrides)) {
        switch (event.type) {
          case 'text':
            responseText += event.text;
            break;
          case 'usage':
            usageTracker.record({
              agentId: targetAgentId,
              sessionKey: inbound.sessionKey,
              model: agentProviderNames.get(targetAgentId) === 'anthropic'
                ? (registry.find(a => a.id === targetAgentId)?.model ?? modelName)
                : modelName,
              provider: agentProviderNames.get(targetAgentId) ?? providerName,
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
            });
            break;
          case 'done':
            responseText = event.response || responseText;
            break;
          case 'error':
            log.error({ error: event.error }, 'Agent error');
            responseText = 'Sorry, I encountered an error processing your message.';
            break;
        }
      }
    } catch (err) {
      log.error({ error: err }, 'Agent loop error');
      responseText = 'Sorry, something went wrong.';
    }

    // Hook: agent response complete
    triggerHook(createHookEvent('agent', 'response', inbound.sessionKey, {
      agentId: targetAgentId,
      responseLength: responseText.length,
    })).catch(() => {});

    // Log to flat + semantic memory
    try {
      await mm.log(`[${inbound.channelName}/${inbound.userId}] ${content}`);
      if (responseText) {
        await mm.log(`[assistant] ${responseText.slice(0, 500)}`);
      }
      mm.ingestMessages([
        userMessage,
        { id: `msg_${Date.now()}_resp`, role: 'assistant', content: responseText, timestamp: new Date().toISOString() },
      ]).catch(() => {});
    } catch {
      // Non-critical
    }

    session.updatedAt = new Date().toISOString();

    return { text: responseText };
  }

  // Voice-aware channel handler: wraps handleMessage with STT/TTS + sender approval
  async function handleChannelMessage(
    inbound: InboundMessage,
    sendFn: (sessionKey: string, content: OutboundMessage) => Promise<void>,
  ): Promise<void> {
    // Sender approval check
    if (!senderApproval.isApproved(inbound.userId, inbound.channelName)) {
      const mode = senderApproval.getMode();
      if (mode === 'pairing') {
        const code = senderApproval.generatePairingCode(inbound.userId, inbound.channelName);

        if (inbound.content.trim().length === 6 && /^[A-Z0-9]+$/.test(inbound.content.trim().toUpperCase())) {
          if (senderApproval.verifyPairingCode(inbound.userId, inbound.channelName, inbound.content.trim())) {
            await sendFn(inbound.sessionKey, { text: 'Pairing successful! You can now send messages.' });
            return;
          }
        }

        await sendFn(inbound.sessionKey, { text: `Please enter your pairing code to start chatting. Your code: ${code}` });
      } else {
        await sendFn(inbound.sessionKey, { text: 'You are not authorized to send messages.' });
      }
      return;
    }

    const response = await handleMessage(inbound);
    const outbound: OutboundMessage = { text: response.text };

    // Synthesize voice reply if input was voice and autoVoiceReply is on
    if (voicePipeline && response.text) {
      const shouldVoice = voicePipeline.shouldReplyWithVoice(inbound, {
        autoVoiceReply: config.voice.autoVoiceReply,
      });

      if (shouldVoice) {
        try {
          const voiceTargetId = await selectAgent(inbound.content);
          const targetAgent = registry.find(a => a.id === voiceTargetId);
          const audioBuffer = await voicePipeline.processOutgoing(response.text, targetAgent?.voiceId);
          outbound.media = [{
            type: 'voice' as const,
            buffer: audioBuffer,
            mimeType: 'audio/ogg',
          }];
          log.info({ bytes: audioBuffer.length }, 'Voice response synthesized');
        } catch (err) {
          log.error({ error: err }, 'Voice synthesis failed, sending text only');
        }
      }
    }

    await sendFn(inbound.sessionKey, outbound);
  }

  return {
    handleMessage,
    handleChannelMessage,
    selectAgent,
    getMessageCount: () => totalMessages,
  };
}
