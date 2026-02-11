import type { Message } from '@vena/shared';

export type OpenAICompatRaw = {
  messages?: Array<{ role: string; content: string }>;
};

export function extractOpenAiHistory(
  rawMessages: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  const lastUserIndex = [...rawMessages].map(m => m.role).lastIndexOf('user');
  if (lastUserIndex <= 0) return [];
  return rawMessages.slice(0, lastUserIndex).filter(m => m.role !== 'system');
}

export function extractOpenAiSystemMessages(
  rawMessages: Array<{ role: string; content: string }>,
): string[] {
  const seen = new Set<string>();
  const system: string[] = [];
  for (const msg of rawMessages) {
    if (msg.role !== 'system') continue;
    const normalized = msg.content.trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    system.push(normalized);
  }
  return system;
}

export function extractOpenAiSystemPrompt(
  rawMessages: Array<{ role: string; content: string }>,
): string | undefined {
  const system = extractOpenAiSystemMessages(rawMessages).join('\n\n').trim();
  return system.length > 0 ? system : undefined;
}

export function mapOpenAiMessages(
  rawMessages: Array<{ role: string; content: string }>,
): Message[] {
  const now = () => new Date().toISOString();
  return rawMessages.map((m, idx) => {
    const role: Message['role'] =
      m.role === 'assistant' || m.role === 'system' || m.role === 'tool'
        ? m.role
        : 'user';
    return {
      id: `msg_hist_${idx}_${Date.now()}`,
      role,
      content: m.content,
      timestamp: now(),
    };
  });
}
