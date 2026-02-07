import type { ConsultationRequest, ConsultationResponse } from '@vena/shared';
import { AgentError } from '@vena/shared';
import type { AgentRegistry } from './agent-registry.js';
import type { MessageBus, BusMessage } from './message-bus.js';

export class ConsultationManager {
  private pending = new Map<string, {
    resolve: (responses: ConsultationResponse[]) => void;
    responses: ConsultationResponse[];
    expectedCount: number;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(
    private bus: MessageBus,
    private registry: AgentRegistry,
    private timeout: number = 30000,
  ) {
    this.bus.subscribe('consultation:response', (msg: BusMessage) => {
      const response = msg.payload as ConsultationResponse;
      const entry = this.pending.get(response.requestId);
      if (entry) {
        entry.responses.push(response);
        if (entry.responses.length >= entry.expectedCount) {
          clearTimeout(entry.timer);
          entry.resolve(entry.responses);
          this.pending.delete(response.requestId);
        }
      }
    });
  }

  consult(request: ConsultationRequest): Promise<ConsultationResponse[]> {
    return new Promise<ConsultationResponse[]>((resolve, reject) => {
      if (request.toAgentId !== 'broadcast') {
        const agent = this.registry.get(request.toAgentId);
        if (!agent) {
          reject(new AgentError(`Agent not found: ${request.toAgentId}`, request.fromAgentId));
          return;
        }
      }

      const expectedCount = request.toAgentId === 'broadcast'
        ? this.registry.getAll().filter((a) => a.id !== request.fromAgentId && a.status !== 'offline').length
        : 1;

      const timer = setTimeout(() => {
        const entry = this.pending.get(request.id);
        if (entry) {
          this.pending.delete(request.id);
          if (entry.responses.length > 0) {
            resolve(entry.responses);
          } else {
            reject(new AgentError(`Consultation timed out: ${request.id}`, request.fromAgentId));
          }
        }
      }, request.timeout || this.timeout);

      this.pending.set(request.id, {
        resolve,
        responses: [],
        expectedCount,
        timer,
      });

      this.bus.publish('consultation:request', {
        type: 'consultation_request',
        fromAgentId: request.fromAgentId,
        toAgentId: request.toAgentId === 'broadcast' ? undefined : request.toAgentId,
        payload: request,
        priority: request.priority,
      });
    });
  }

  consultMultiple(request: ConsultationRequest, agentIds: string[]): Promise<ConsultationResponse[]> {
    return new Promise<ConsultationResponse[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        const entry = this.pending.get(request.id);
        if (entry) {
          this.pending.delete(request.id);
          if (entry.responses.length > 0) {
            resolve(entry.responses);
          } else {
            reject(new AgentError(`Consultation timed out: ${request.id}`, request.fromAgentId));
          }
        }
      }, request.timeout || this.timeout);

      this.pending.set(request.id, {
        resolve,
        responses: [],
        expectedCount: agentIds.length,
        timer,
      });

      for (const agentId of agentIds) {
        this.bus.publish('consultation:request', {
          type: 'consultation_request',
          fromAgentId: request.fromAgentId,
          toAgentId: agentId,
          payload: { ...request, toAgentId: agentId },
          priority: request.priority,
        });
      }
    });
  }

  findConsensus(responses: ConsultationResponse[]): {
    answer: string;
    confidence: number;
    agreementLevel: number;
  } {
    if (responses.length === 0) {
      return { answer: '', confidence: 0, agreementLevel: 0 };
    }

    if (responses.length === 1) {
      return {
        answer: responses[0]!.answer,
        confidence: responses[0]!.confidence,
        agreementLevel: 1,
      };
    }

    // Group similar answers and find the most common
    const answerGroups = new Map<string, ConsultationResponse[]>();
    for (const response of responses) {
      const normalized = response.answer.toLowerCase().trim();
      const existing = answerGroups.get(normalized);
      if (existing) {
        existing.push(response);
      } else {
        answerGroups.set(normalized, [response]);
      }
    }

    // Find the largest group
    let bestGroup: ConsultationResponse[] = [];
    for (const group of answerGroups.values()) {
      if (group.length > bestGroup.length) {
        bestGroup = group;
      }
    }

    const agreementLevel = bestGroup.length / responses.length;
    const avgConfidence =
      bestGroup.reduce((sum, r) => sum + r.confidence, 0) / bestGroup.length;

    // Use the highest-confidence answer from the best group
    const bestResponse = bestGroup.reduce((best, r) =>
      r.confidence > best.confidence ? r : best,
    );

    return {
      answer: bestResponse.answer,
      confidence: avgConfidence,
      agreementLevel,
    };
  }
}
