import type { HookEvent, HookEventType, HookHandler } from './types.js';

/**
 * Hook Registry — event-driven hook system for Vena agent lifecycle.
 *
 * Handlers can be registered for:
 * - A general event type (e.g., 'tool') — fires for all actions
 * - A specific event:action (e.g., 'tool:before') — fires only for that action
 *
 * Handlers run in registration order. Errors are caught and logged
 * but don't prevent other handlers from running.
 */

const handlers = new Map<string, HookHandler[]>();

export function registerHook(eventKey: string, handler: HookHandler): void {
  if (!handlers.has(eventKey)) {
    handlers.set(eventKey, []);
  }
  handlers.get(eventKey)!.push(handler);
}

export function unregisterHook(eventKey: string, handler: HookHandler): void {
  const list = handlers.get(eventKey);
  if (!list) return;

  const idx = list.indexOf(handler);
  if (idx !== -1) {
    list.splice(idx, 1);
  }
  if (list.length === 0) {
    handlers.delete(eventKey);
  }
}

export function clearHooks(): void {
  handlers.clear();
}

export function getRegisteredEventKeys(): string[] {
  return Array.from(handlers.keys());
}

export function getHandlerCount(eventKey?: string): number {
  if (eventKey) {
    return handlers.get(eventKey)?.length ?? 0;
  }
  let total = 0;
  for (const list of handlers.values()) {
    total += list.length;
  }
  return total;
}

export async function triggerHook(event: HookEvent): Promise<void> {
  const typeHandlers = handlers.get(event.type) ?? [];
  const specificHandlers = handlers.get(`${event.type}:${event.action}`) ?? [];
  const allHandlers = [...typeHandlers, ...specificHandlers];

  if (allHandlers.length === 0) return;

  for (const handler of allHandlers) {
    try {
      await handler(event);
    } catch (err) {
      console.error(
        `[vena:hook] Error in ${event.type}:${event.action}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

export function createHookEvent(
  type: HookEventType,
  action: string,
  sessionKey: string,
  context: Record<string, unknown> = {},
): HookEvent {
  return {
    type,
    action,
    sessionKey,
    context,
    timestamp: new Date(),
    messages: [],
  };
}
